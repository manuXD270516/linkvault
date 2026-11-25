import { randomUUID } from 'node:crypto';
import {
  groupWeeklyBriefSchema,
  verifyGroupWeeklyBrief,
  type GroupWeeklyBrief,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection, Types, mongo } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GROUP_WEEKLY_BRIEFS_COLLECTION } from '../infrastructure/persistence/group-weekly-brief.document';
import { MongoGroupBriefCatalog } from '../infrastructure/persistence/mongo-group-brief.catalog';
import {
  MongoGroupBriefStore,
  ensureGroupBriefIndexes,
} from '../infrastructure/persistence/mongo-group-brief.store';
import { ComputeGroupWeeklyBriefs } from './compute-group-weekly-briefs.usecase';

const { EJSON } = mongo.BSON;

const NOW = new Date('2026-11-25T05:00:00.000Z');
const ANA = new Types.ObjectId();
const BETO = new Types.ObjectId();
const NOTE = 'Ana says: ask Carla for a referral';
const TAG = 'tag-referral-only';
const COMMENT = 'Beto comment: salary is low here';

let connection: Connection;
let commands: { name: string; body: Record<string, unknown> }[] = [];

/** Documento tal como queda en Mongo → contrato (lo que hace `fromDocument` en la api). */
function fromDocument(doc: Record<string, unknown>): unknown {
  const { _id, ...rest } = doc;
  void _id;
  return {
    ...rest,
    groupId: String(doc['groupId']),
    computedAt: (doc['computedAt'] as Date).toISOString(),
  };
}

async function addGroup(): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await connection.collection('groups').insertOne({
    _id,
    name: 'Grupo de Ana y Beto',
    ownerId: ANA,
    memberIds: [ANA, BETO],
  });
  return _id;
}

async function addOffer(
  groupId: Types.ObjectId,
  sharedBy: Types.ObjectId,
  sharedAt: Date,
  link: { expiresAt: string | null; skills: string[]; closedAt?: Date },
): Promise<Types.ObjectId> {
  const linkId = new Types.ObjectId();
  await connection.collection('job_links').insertOne({
    _id: linkId,
    displayUrl: 'example.com/job',
    ...(link.closedAt === undefined ? {} : { closedAt: link.closedAt }),
    preview: {
      title: 'Backend engineer',
      company: 'Acme',
      expiresAt: link.expiresAt,
      skills: link.skills.map((name) => ({ name, required: true })),
    },
  });
  await connection.collection('group_links').insertOne({
    groupId,
    linkId,
    sharedBy,
    sharedAt,
    note: NOTE,
    tags: [TAG],
    pinned: true,
    knowSomeoneUserIds: [ANA, BETO],
  });
  await connection.collection('group_link_comments').insertOne({
    groupId,
    linkId,
    userId: BETO,
    text: COMMENT,
  });
  await connection.collection('applications').insertOne({
    userId: ANA,
    linkId,
    status: 'applied',
    visibility: 'private',
    notes: 'private application note',
  });
  return linkId;
}

function useCase(): ComputeGroupWeeklyBriefs {
  return new ComputeGroupWeeklyBriefs(
    new MongoGroupBriefCatalog(connection),
    new MongoGroupBriefStore(connection),
    true,
    verifyGroupWeeklyBrief,
  );
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `group-brief-int-${randomUUID()}`,
      monitorCommands: true,
    })
    .asPromise();
  expect(await ensureGroupBriefIndexes(connection)).toBe(true);
  connection.getClient().on('commandStarted', (event) => {
    commands.push({
      name: event.commandName,
      body: event.command as Record<string, unknown>,
    });
  });
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('group weekly brief end to end', () => {
  it('stored document leaks nothing about members and never reads private collections', async () => {
    const groupId = await addGroup();
    await addOffer(groupId, ANA, new Date('2026-11-24T10:00:00.000Z'), {
      expiresAt: '2026-11-28',
      skills: ['Docker', 'TypeScript'],
    });
    await addOffer(groupId, BETO, new Date('2026-11-24T11:00:00.000Z'), {
      expiresAt: null,
      skills: ['docker'],
    });
    commands = [];

    const summary = await useCase().execute(NOW);
    expect(summary).toMatchObject({ groupsScanned: 1, upserted: 1 });

    const stored = await connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .findOne({ groupId });
    expect(stored).not.toBeNull();
    const serialized = EJSON.stringify(stored as mongo.BSON.Document, {
      relaxed: false,
    });
    for (const secret of [
      ANA.toHexString(),
      BETO.toHexString(),
      'Ana',
      'Beto',
      NOTE,
      TAG,
      COMMENT,
      'Backend engineer',
      'private application note',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    const touched = new Set(
      commands
        .map((c) => c.body[c.name])
        .filter((v): v is string => typeof v === 'string'),
    );
    expect(touched.has('applications')).toBe(false);
    expect(touched.has('users')).toBe(false);
    expect(touched.has('group_link_comments')).toBe(false);

    const relationReads = commands.filter(
      (c) => c.name === 'find' && c.body['find'] === 'group_links',
    );
    expect(relationReads).toHaveLength(1);
    expect(relationReads[0]?.body['projection']).toEqual({
      _id: 0,
      linkId: 1,
      sharedAt: 1,
    });
  });

  it('worker document reads back through fromDocument', async () => {
    const groupId = await addGroup();
    await addOffer(groupId, ANA, new Date('2026-11-24T10:00:00.000Z'), {
      expiresAt: '2026-11-27',
      skills: ['Docker'],
    });
    await addOffer(groupId, BETO, new Date('2026-11-18T10:00:00.000Z'), {
      expiresAt: null,
      skills: ['Docker'],
    });
    await useCase().execute(NOW);

    const stored = await connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .findOne({ groupId });
    const parsed = groupWeeklyBriefSchema.safeParse(
      fromDocument(stored as Record<string, unknown>),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const brief: GroupWeeklyBrief = parsed.data;
      expect(verifyGroupWeeklyBrief(brief)).toEqual({ ok: true });
      expect(brief.groupId).toBe(groupId.toHexString());
    }
  });

  it('demo-like group yields closing, docker and typescript bullets in that relative order', async () => {
    // El mismo universo que el seed demo (D12): cinco links compartidos hoy, uno cerrado y uno sin habilidades.
    const groupId = await addGroup();
    const today = new Date('2026-11-25T03:00:00.000Z');
    const closes = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await addOffer(groupId, ANA, today, {
      expiresAt: null,
      skills: ['Docker', 'TypeScript', 'NestJS'],
    });
    await addOffer(groupId, ANA, today, {
      expiresAt: null,
      skills: [],
      closedAt: new Date('2026-09-20T12:00:00.000Z'),
    });
    await addOffer(groupId, ANA, today, { expiresAt: null, skills: [] });
    await addOffer(groupId, ANA, today, {
      expiresAt: null,
      skills: ['Docker', 'Kotlin'],
    });
    await addOffer(groupId, ANA, today, {
      expiresAt: closes,
      skills: ['Docker', 'TypeScript', 'SQL'],
    });

    await useCase().execute(NOW);

    const stored = await connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .findOne({ groupId });
    const bullets = (stored?.['bullets'] as { factId: string }[]).map(
      (b) => b.factId,
    );
    expect(bullets).toEqual([
      'closing_soon',
      'skill_demand:docker',
      'skill_demand:typescript',
    ]);
    const facts = stored?.['facts'] as {
      factId: string;
      count: number;
      total?: number;
    }[];
    expect(facts.find((f) => f.factId === 'skill_demand:docker')).toMatchObject(
      { count: 3, total: 3 },
    );
    expect(
      facts.find((f) => f.factId === 'skill_demand:typescript'),
    ).toMatchObject({ count: 2, total: 3 });
  });

  it('second tick the same day writes nothing against the real store', async () => {
    const groupId = await addGroup();
    await addOffer(groupId, ANA, new Date('2026-11-24T10:00:00.000Z'), {
      expiresAt: '2026-11-27',
      skills: ['Docker'],
    });
    await addOffer(groupId, BETO, new Date('2026-11-24T10:30:00.000Z'), {
      expiresAt: null,
      skills: ['Docker'],
    });
    await useCase().execute(NOW);
    const later = await useCase().execute(new Date('2026-11-25T18:00:00.000Z'));
    expect(later.unchanged).toBeGreaterThanOrEqual(1);
    expect(
      await connection
        .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
        .countDocuments({ groupId }),
    ).toBe(1);
  });
});
