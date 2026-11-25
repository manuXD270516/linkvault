import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMongoTestUri, workspaceRoot } from '@linkvault/testing';
import mongoose, { type Connection, mongo } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GROUP_WEEKLY_BRIEFS_COLLECTION,
  MongoGroupWeeklyBriefReader,
} from './mongo-group-weekly-brief.reader';

const { EJSON } = mongo.BSON;

const GROUP = '1'.repeat(24);
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const D = 'd'.repeat(24);

let connection: Connection;
let reader: MongoGroupWeeklyBriefReader;
let finds = 0;

function fixture(): mongo.BSON.Document {
  // El mismo fixture que escribe el store del worker (N6): `relaxed: false` conserva int32, fechas y ObjectId.
  const text = readFileSync(
    join(
      workspaceRoot(),
      'libs/shared/src/testing/group-weekly-brief.document.ejson',
    ),
    'utf8',
  );
  return EJSON.parse(text, { relaxed: false }) as mongo.BSON.Document;
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `links-brief-reader-${randomUUID()}`,
      monitorCommands: true,
    })
    .asPromise();
  connection.getClient().on('commandStarted', (event) => {
    if (event.commandName === 'find') {
      finds += 1;
    }
  });
  reader = new MongoGroupWeeklyBriefReader(connection);
});

beforeEach(async () => {
  await connection.collection(GROUP_WEEKLY_BRIEFS_COLLECTION).deleteMany({});
  finds = 0;
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('MongoGroupWeeklyBriefReader', () => {
  it('reads the canonical EJSON fixture written by the worker store', async () => {
    await connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .insertOne(fixture());

    const brief = await reader.findCurrent(GROUP, '2026-W48');

    expect(brief).toEqual({
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
    });
  });

  it('does not fall back to another week', async () => {
    await connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .insertOne(fixture());
    expect(await reader.findCurrent(GROUP, '2026-W49')).toBeNull();
  });

  it('returns invalid for a document that fails the schema', async () => {
    await connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .insertOne({ ...fixture(), bullets: [], extra: 'unexpected' });
    expect(await reader.findCurrent(GROUP, '2026-W48')).toBe('invalid');
  });

  it('malformed group id returns null without query', async () => {
    expect(await reader.findCurrent('not-an-id', '2026-W48')).toBeNull();
    expect(finds).toBe(0);
  });
});
