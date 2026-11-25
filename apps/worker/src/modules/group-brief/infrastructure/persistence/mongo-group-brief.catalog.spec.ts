import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection, Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoGroupBriefCatalog } from './mongo-group-brief.catalog';

let connection: Connection;
let catalog: MongoGroupBriefCatalog;
let started: { command: string; body: Record<string, unknown> }[] = [];

const GROUP = new Types.ObjectId();
const MEMBER = new Types.ObjectId();

async function addOffer(
  index: number,
  link: Record<string, unknown> = {},
): Promise<Types.ObjectId> {
  const linkId = new Types.ObjectId();
  await connection.collection('job_links').insertOne({
    _id: linkId,
    displayUrl: 'example.com/job',
    preview: { title: 'Secret title', expiresAt: null, skills: [] },
    ...link,
  });
  await connection.collection('group_links').insertOne({
    groupId: GROUP,
    linkId,
    sharedBy: MEMBER,
    sharedAt: new Date(Date.UTC(2026, 10, 24, 10, 0, index)),
    note: 'private note',
    tags: ['secret-tag'],
    pinned: true,
    knowSomeoneUserIds: [MEMBER],
  });
  return linkId;
}

function reads(): { command: string; body: Record<string, unknown> }[] {
  return started.filter((c) => c.command === 'find');
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `group-brief-catalog-${randomUUID()}`,
      monitorCommands: true,
    })
    .asPromise();
  connection.getClient().on('commandStarted', (event) => {
    started.push({
      command: event.commandName,
      body: event.command as Record<string, unknown>,
    });
  });
  catalog = new MongoGroupBriefCatalog(connection);
});

beforeEach(async () => {
  await connection.collection('group_links').deleteMany({});
  await connection.collection('job_links').deleteMany({});
  started = [];
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('MongoGroupBriefCatalog.scanGroupOffers', () => {
  it('scan projects only offer fields', async () => {
    await addOffer(1, {
      closedAt: new Date('2026-11-20T00:00:00.000Z'),
      preview: {
        title: 'Secret title',
        expiresAt: '2026-11-30',
        skills: [{ name: 'Docker', required: true }],
      },
    });
    const offers = await catalog.scanGroupOffers(GROUP.toHexString(), 501);
    expect(offers).toHaveLength(1);
    expect(Object.keys(offers[0] ?? {}).sort()).toEqual([
      'closedAt',
      'expiresAt',
      'id',
      'sharedAt',
      'skills',
    ]);
    expect(offers[0]).toMatchObject({
      closedAt: '2026-11-20T00:00:00.000Z',
      expiresAt: '2026-11-30',
      skills: ['Docker'],
    });
    const serialized = JSON.stringify(offers);
    for (const secret of ['private note', 'secret-tag', 'Secret title']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain(MEMBER.toHexString());

    const [relations, links] = reads();
    expect(relations?.body['projection']).toEqual({
      _id: 0,
      linkId: 1,
      sharedAt: 1,
    });
    expect(links?.body['projection']).toEqual({
      closedAt: 1,
      'preview.expiresAt': 1,
      'preview.skills': 1,
    });
  });

  it('invalid skill entries are dropped', async () => {
    await addOffer(1, {
      preview: {
        expiresAt: null,
        skills: [
          { name: 'Docker', required: true },
          { name: '', required: false },
          { name: 'Go' },
          'Rust',
          null,
          { name: 'SQL', required: false, extra: 1 },
        ],
      },
    });
    const [offer] = await catalog.scanGroupOffers(GROUP.toHexString(), 501);
    expect(offer?.skills).toEqual(['Docker']);
  });

  it('scan orders by sharedAt desc and respects the limit', async () => {
    const first = await addOffer(1);
    const second = await addOffer(2);
    await addOffer(3);
    const offers = await catalog.scanGroupOffers(GROUP.toHexString(), 3);
    expect(offers.map((o) => o.sharedAt)).toEqual([
      '2026-11-24T10:00:03.000Z',
      '2026-11-24T10:00:02.000Z',
      '2026-11-24T10:00:01.000Z',
    ]);
    expect(offers[1]?.id).toBe(second.toHexString());
    expect(offers[2]?.id).toBe(first.toHexString());
    expect(await catalog.scanGroupOffers(GROUP.toHexString(), 2)).toHaveLength(
      2,
    );
  });

  it('scan makes two reads for 3 and 300 links', async () => {
    for (const total of [3, 300]) {
      await connection.collection('group_links').deleteMany({});
      await connection.collection('job_links').deleteMany({});
      for (let i = 0; i < total; i += 1) {
        await addOffer(i % 60);
      }
      started = [];
      const offers = await catalog.scanGroupOffers(GROUP.toHexString(), 501);
      expect(offers).toHaveLength(total);
      expect(reads()).toHaveLength(2);
    }
  });
});

describe('MongoGroupBriefCatalog groups and stored briefs', () => {
  it('listGroupIds pages by _id', async () => {
    const groups = connection.collection('groups');
    await groups.deleteMany({});
    const ids = Array.from({ length: 5 }, () => new Types.ObjectId());
    await groups.insertMany(ids.map((_id) => ({ _id })));
    const sorted = ids.map(String).sort();
    const page1 = await catalog.listGroupIds(null, 2);
    expect(page1.groupIds).toEqual(sorted.slice(0, 2));
    const page2 = await catalog.listGroupIds(page1.nextCursor, 2);
    expect(page2.groupIds).toEqual(sorted.slice(2, 4));
    const page3 = await catalog.listGroupIds(page2.nextCursor, 2);
    expect(page3.groupIds).toEqual(sorted.slice(4));
    expect(page3.nextCursor).toBeNull();
  });

  it('currentBriefsOf reads the week of a page in one query', async () => {
    const briefs = connection.collection('group_weekly_briefs');
    await briefs.deleteMany({});
    const other = new Types.ObjectId();
    await briefs.insertMany([
      { groupId: GROUP, weekKey: '2026-W48', asOf: '2026-11-25' },
      { groupId: GROUP, weekKey: '2026-W47', asOf: '2026-11-18' },
      { groupId: other, weekKey: '2026-W48', asOf: '2026-11-25' },
    ]);
    started = [];
    const found = await catalog.currentBriefsOf(
      [GROUP.toHexString(), other.toHexString()],
      '2026-W48',
    );
    expect([...found.keys()].sort()).toEqual(
      [GROUP.toHexString(), other.toHexString()].sort(),
    );
    expect(found.get(GROUP.toHexString())?.['asOf']).toBe('2026-11-25');
    expect(reads()).toHaveLength(1);
  });
});
