import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoWeeklyPlanDecisionRepository } from './mongo-weekly-plan-decision.repository';
import {
  WEEKLY_PLAN_DECISION_MODEL_NAME,
  WEEKLY_PLAN_DECISIONS_COLLECTION,
} from './weekly-plan-decision.schemas';

// Adaptador Mongo de WEEKLY_PLAN_DECISION_REPOSITORY (tarea 4.1 de weekly-plan) contra el MongoMemoryReplSet del preset
// de @linkvault/testing.

let connection: Connection;
let repository: MongoWeeklyPlanDecisionRepository;

const oid = (): string => new mongoose.Types.ObjectId().toHexString();
const ANA = oid();
const BETO = oid();
const T0 = new Date('2026-11-25T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function documents() {
  return connection.collection(WEEKLY_PLAN_DECISIONS_COLLECTION);
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `weekly-plan-${randomUUID()}`,
    })
    .asPromise();
  repository = new MongoWeeklyPlanDecisionRepository(connection);
  await connection.model(WEEKLY_PLAN_DECISION_MODEL_NAME).init();
});

afterEach(async () => {
  await documents().deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('MongoWeeklyPlanDecisionRepository', () => {
  it('upsert keeps a single document per key with the last decision', async () => {
    const key = { candidateId: 'follow_up:abc', weekKey: '2026-W48' };
    await repository.upsert(ANA, { ...key, decision: 'snoozed', decidedAt: T0 });
    await repository.upsert(ANA, {
      ...key,
      decision: 'done',
      decidedAt: new Date(T0.getTime() + 1000),
    });

    expect(await documents().countDocuments()).toBe(1);
    const stored = await repository.listActive(ANA, T0);
    expect(stored).toEqual([
      { ...key, decision: 'done', decidedAt: new Date(T0.getTime() + 1000) },
    ]);
  });

  it("listActive returns only the user's decisions", async () => {
    const base = { weekKey: '2026-W48', decidedAt: T0 };
    await repository.upsert(ANA, {
      ...base,
      candidateId: 'follow_up:a',
      decision: 'done',
    });
    await repository.upsert(BETO, {
      ...base,
      candidateId: 'follow_up:b',
      decision: 'dismissed',
    });

    const mine = await repository.listActive(ANA, T0);

    expect(mine.map((decision) => decision.candidateId)).toEqual([
      'follow_up:a',
    ]);
    await expect(repository.listActive('no-es-un-id', T0)).resolves.toEqual([]);
  });

  it('listActive ignores decisions older than 35 days even if the document still exists', async () => {
    await repository.upsert(ANA, {
      candidateId: 'follow_up:a',
      weekKey: '2026-W48',
      decision: 'dismissed',
      decidedAt: T0,
    });
    const edge = new Date(T0.getTime() + 35 * DAY_MS);

    expect(await repository.listActive(ANA, edge)).toHaveLength(1);
    expect(
      await repository.listActive(ANA, new Date(edge.getTime() + 1000)),
    ).toHaveLength(0);
    expect(await documents().countDocuments()).toBe(1);
  });

  it('declares the unique and TTL indexes', async () => {
    const indexes = await documents().listIndexes().toArray();

    const unique = indexes.find(
      (index) =>
        JSON.stringify(index.key) ===
        JSON.stringify({ userId: 1, weekKey: 1, candidateId: 1 }),
    );
    const ttl = indexes.find(
      (index) => JSON.stringify(index.key) === JSON.stringify({ decidedAt: 1 }),
    );
    expect(unique?.unique).toBe(true);
    expect(ttl?.expireAfterSeconds).toBe(3_024_000);
  });
});
