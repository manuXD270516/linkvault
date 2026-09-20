import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executionKey } from '../../application/execution-key';
import type {
  UsageOutcome,
  UsageRecord,
} from '../../domain/ports/usage-ledger.port';
import { AI_USAGE_COLLECTION, aiUsageSchema } from './ai-usage.schema';
import { MongoUsageLedger } from './mongo-usage-ledger';

// Requisitos "Registro de cada intento" y "El ledger no guarda contenido" (specs/ai/usage-accounting) y D9 de
// ai-gateway-core, contra el MongoMemoryReplSet del preset de @linkvault/testing.

let connection: Connection;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `ai-ledger-${randomUUID()}`,
    })
    .asPromise();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

const at = new Date('2026-09-17T10:00:00.000Z');
const key = 'b'.repeat(64);

function attempt(
  outcome: UsageOutcome,
  overrides: Partial<UsageRecord> = {},
): UsageRecord {
  return {
    userId: 'user-1',
    task: 'classify-skills',
    providerId: 'ollama',
    model: 'qwen2.5:7b',
    inputTokens: 120,
    outputTokens: 30,
    estCost: 0,
    latencyMs: 850,
    outcome,
    promptVersion: 'v1',
    key,
    at,
    ...overrides,
  };
}

async function rawDocuments(filter: object): Promise<object[]> {
  return connection
    .collection(AI_USAGE_COLLECTION)
    .find(filter, { projection: { _id: 0 } })
    .toArray();
}

describe('MongoUsageLedger', () => {
  it('declares bufferCommands false and the { userId, task, at } index', async () => {
    const ledger = new MongoUsageLedger(connection);
    await ledger.record(attempt('success', { userId: 'index-probe' }));
    await connection.model('AiUsage').syncIndexes();

    expect(aiUsageSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection.collection(AI_USAGE_COLLECTION).indexes();
    expect(indexes.map((index) => index.key)).toContainEqual({
      userId: 1,
      task: 1,
      at: -1,
    });
  });

  it.each<UsageOutcome>(['success', 'schema_error', 'provider_error'])(
    'writes a %s attempt with its provider metrics',
    async (outcome) => {
      const userId = `attempt-${outcome}`;
      const ledger = new MongoUsageLedger(connection);

      await ledger.record(attempt(outcome, { userId, estCost: 0.0021 }));

      expect(await rawDocuments({ userId })).toEqual([
        {
          userId,
          task: 'classify-skills',
          providerId: 'ollama',
          model: 'qwen2.5:7b',
          inputTokens: 120,
          outputTokens: 30,
          estCost: 0.0021,
          latencyMs: 850,
          outcome,
          promptVersion: 'v1',
          key,
          at,
        },
      ]);
    },
  );

  it('writes a degraded record with its reason, null provider and model, and zeros', async () => {
    const ledger = new MongoUsageLedger(connection);

    await ledger.record(
      attempt('degraded', {
        userId: 'degraded-user',
        providerId: null,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        estCost: 0,
        latencyMs: 0,
        reason: 'providers_failed',
      }),
    );

    expect(await rawDocuments({ userId: 'degraded-user' })).toEqual([
      {
        userId: 'degraded-user',
        task: 'classify-skills',
        providerId: null,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        estCost: 0,
        latencyMs: 0,
        outcome: 'degraded',
        reason: 'providers_failed',
        promptVersion: 'v1',
        key,
        at,
      },
    ]);
  });

  it('writes a quota record with null provider and model, zeros and no user-less fields invented', async () => {
    const ledger = new MongoUsageLedger(connection);

    await ledger.record(
      attempt('quota', {
        userId: 'quota-user',
        providerId: null,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        estCost: 0,
        latencyMs: 0,
      }),
    );
    await ledger.record(
      attempt('degraded', {
        userId: undefined,
        key: 'c'.repeat(64),
        providerId: null,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        estCost: 0,
        latencyMs: 0,
        reason: 'no_providers',
      }),
    );

    const [quota] = await rawDocuments({ userId: 'quota-user' });
    expect(quota).toMatchObject({
      outcome: 'quota',
      providerId: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estCost: 0,
      latencyMs: 0,
    });
    expect(quota).not.toHaveProperty('reason');

    const [systemRun] = await rawDocuments({ key: 'c'.repeat(64) });
    expect(systemRun).not.toHaveProperty('userId');
    expect(systemRun).toMatchObject({ reason: 'no_providers' });
  });

  it('Input con datos personales', async () => {
    const input = {
      text: 'Ana Pérez, ana.perez@example.com, +591 71234567, TypeScript',
    };
    const inputKey = executionKey({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input,
    });
    const ledger = new MongoUsageLedger(connection);

    // Aunque quien llama cuele contenido en el objeto, el documento solo tiene métricas.
    await ledger.record({
      ...attempt('success', { userId: 'pii-user', key: inputKey }),
      input,
      prompt: `Classify: ${input.text}`,
      output: { skills: [{ name: 'ana.perez@example.com' }] },
    } as UsageRecord);

    const documents = await rawDocuments({ userId: 'pii-user' });
    expect(documents).toHaveLength(1);
    const serialized = JSON.stringify(documents);
    expect(serialized).not.toContain('ana.perez@example.com');
    expect(serialized).not.toContain('71234567');
    expect(serialized).not.toContain(input.text);
    expect(serialized).toContain(inputKey);
    expect(Object.keys(documents[0] ?? {}).sort()).toEqual(
      [
        'at',
        'estCost',
        'inputTokens',
        'key',
        'latencyMs',
        'model',
        'outcome',
        'outputTokens',
        'promptVersion',
        'providerId',
        'task',
        'userId',
      ].sort(),
    );
  });

  it('counts only successes of the user and task since the given date', async () => {
    const ledger = new MongoUsageLedger(connection);
    const since = new Date(at.getTime() - 24 * 60 * 60 * 1000);
    const userId = 'count-user';

    await ledger.record(attempt('success', { userId }));
    await ledger.record(attempt('success', { userId }));
    await ledger.record(attempt('provider_error', { userId }));
    await ledger.record(
      attempt('success', { userId, at: new Date(since.getTime() - 1) }),
    );
    await ledger.record(attempt('success', { userId: 'other-user' }));

    await expect(
      ledger.countSuccessesSince({
        userId,
        task: 'classify-skills',
        since,
        maxTimeMS: 300,
      }),
    ).resolves.toBe(2);
  });

  it('returns the oldest success within the window', async () => {
    const ledger = new MongoUsageLedger(connection);
    const since = new Date(at.getTime() - 24 * 60 * 60 * 1000);
    const userId = 'oldest-user';
    const older = new Date(at.getTime() - 60_000);
    const newer = at;

    await ledger.record(attempt('success', { userId, at: newer }));
    await ledger.record(attempt('success', { userId, at: older }));
    await ledger.record(
      attempt('success', { userId, at: new Date(since.getTime() - 1) }),
    );

    await expect(
      ledger.oldestSuccessSince({
        userId,
        task: 'classify-skills',
        since,
        maxTimeMS: 300,
      }),
    ).resolves.toEqual(older);
  });

  it('rejects a write immediately when the connection is not open instead of buffering it', async () => {
    const closed = mongoose.createConnection();
    const ledger = new MongoUsageLedger(closed);

    const started = Date.now();
    await expect(ledger.record(attempt('success'))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
