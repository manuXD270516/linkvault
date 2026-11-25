import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GroupWeeklyBrief } from '@linkvault/shared';
import { getMongoTestUri, workspaceRoot } from '@linkvault/testing';
import { BSON } from 'mongodb';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GROUP_WEEKLY_BRIEFS_COLLECTION,
  toDocument,
} from './group-weekly-brief.document';
import { GROUP_WEEKLY_BRIEF_MODEL_NAME } from './group-weekly-brief.schemas';
import {
  MongoGroupBriefStore,
  ensureGroupBriefIndexes,
} from './mongo-group-brief.store';

const { EJSON } = BSON;

const GROUP = '1'.repeat(24);
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const D = 'd'.repeat(24);

/** El mismo brief que describe el fixture EJSON canónico. */
function canonicalBrief(): GroupWeeklyBrief {
  return {
    version: 1,
    groupId: GROUP,
    weekKey: '2026-W48',
    asOf: '2026-11-25',
    computedAt: '2026-11-25T05:00:00.000Z',
    scanTruncated: false,
    facts: [
      {
        kind: 'open_offers',
        factId: 'open_offers',
        count: 3,
        linkIds: [A, B, C],
      },
      {
        kind: 'closing_soon',
        factId: 'closing_soon',
        count: 1,
        linkIds: [A],
        from: '2026-11-25',
        until: '2026-12-02',
        firstExpiresAt: '2026-11-27',
      },
      {
        kind: 'skill_demand',
        factId: 'skill_demand:docker',
        skillKey: 'docker',
        skillLabel: 'Docker',
        count: 2,
        total: 3,
        linkIds: [A, B],
      },
      {
        kind: 'shared_last_week',
        factId: 'shared_last_week',
        count: 1,
        linkIds: [D],
        weekKey: '2026-W47',
      },
    ],
    bullets: [
      { factId: 'closing_soon', source: 'template' },
      { factId: 'skill_demand:docker', source: 'template' },
      { factId: 'shared_last_week', source: 'template' },
    ],
  };
}

/** Lleva ambos lados al mismo espacio: EJSON canónico y vuelta, para comparar con `toEqual` (N6). */
function canonical(value: unknown): unknown {
  return EJSON.parse(
    EJSON.stringify(value as BSON.Document, { relaxed: false }),
    {
      relaxed: false,
    },
  );
}

let connection: Connection;
let store: MongoGroupBriefStore;

function collection() {
  return connection.collection(GROUP_WEEKLY_BRIEFS_COLLECTION);
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `group-brief-${randomUUID()}`,
    })
    .asPromise();
  expect(await ensureGroupBriefIndexes(connection)).toBe(true);
  store = new MongoGroupBriefStore(connection);
});

beforeEach(async () => {
  await collection().deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('MongoGroupBriefStore', () => {
  it('replace upserts then replaces in place', async () => {
    await store.replace(toDocument(canonicalBrief()));
    const first = await collection().findOne({});
    const changed = { ...canonicalBrief(), asOf: '2026-11-26' };
    await store.replace(toDocument(changed));
    const docs = await collection().find({}).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.['asOf']).toBe('2026-11-26');
    expect(docs[0]?._id.toHexString()).toBe(first?._id.toHexString());
  });

  it('concurrent replaces leave one document without error', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        store.replace(toDocument(canonicalBrief())),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    expect(await collection().countDocuments({})).toBe(1);
  });

  it('computedAt is stored as BSON date', async () => {
    await store.replace(toDocument(canonicalBrief()));
    const doc = await collection().findOne({});
    expect(doc?.['computedAt']).toBeInstanceOf(Date);
    const types = await collection()
      .aggregate([{ $project: { t: { $type: '$computedAt' } } }])
      .toArray();
    expect(types[0]?.['t']).toBe('date');
  });

  it('toDocument has no _id', () => {
    expect(Object.keys(toDocument(canonicalBrief()))).not.toContain('_id');
  });

  it('writes the canonical EJSON fixture', async () => {
    const text = readFileSync(
      join(
        workspaceRoot(),
        'libs/shared/src/testing/group-weekly-brief.document.ejson',
      ),
      'utf8',
    );
    await store.replace(toDocument(canonicalBrief()));
    const stored = await collection().findOne({});
    const { _id, ...withoutId } = stored ?? {};
    expect(_id).toBeDefined();
    expect(canonical(withoutId)).toEqual(EJSON.parse(text, { relaxed: false }));
  });

  it('clear removes only that group and week', async () => {
    await store.replace(toDocument(canonicalBrief()));
    await store.replace(
      toDocument({ ...canonicalBrief(), weekKey: '2026-W47' }),
    );
    await store.replace(
      toDocument({ ...canonicalBrief(), groupId: '2'.repeat(24) }),
    );
    await store.clear(GROUP, '2026-W48');
    expect(await collection().countDocuments({})).toBe(2);
    expect(await collection().countDocuments({ weekKey: '2026-W48' })).toBe(1);
  });
});

describe('ensureGroupBriefIndexes', () => {
  it('indexes exist on an empty collection before the first tick', async () => {
    const fresh = await mongoose
      .createConnection(getMongoTestUri(), {
        dbName: `group-brief-idx-${randomUUID()}`,
      })
      .asPromise();
    try {
      await ensureGroupBriefIndexes(fresh);
      const indexes = await fresh
        .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
        .listIndexes()
        .toArray();
      const unique = indexes.find((i) => i['unique'] === true);
      expect(unique?.['key']).toEqual({ groupId: 1, weekKey: 1 });
      const ttl = indexes.find((i) => i['expireAfterSeconds'] !== undefined);
      expect(ttl?.['key']).toEqual({ computedAt: 1 });
      expect(ttl?.['expireAfterSeconds']).toBe(3_024_000);
      await fresh.dropDatabase();
    } finally {
      await fresh.close();
    }
  });

  it('returns false and logs when the indexes cannot be created', async () => {
    const failing = {
      models: {
        [GROUP_WEEKLY_BRIEF_MODEL_NAME]: {
          init: () => Promise.reject(new Error('index build failed')),
        },
      },
    } as unknown as Connection;
    const errors: string[] = [];
    const ok = await ensureGroupBriefIndexes(failing, {
      error: (message: unknown) => {
        errors.push(String(message));
      },
    });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
  });
});
