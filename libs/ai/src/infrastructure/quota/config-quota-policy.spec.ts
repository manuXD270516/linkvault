import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiLogFields, AiLogger } from '../../domain/ports/ai-logger.port';
import type { Clock } from '../../domain/ports/clock.port';
import type {
  UsageOutcome,
  UsageRecord,
} from '../../domain/ports/usage-ledger.port';
import {
  MongoUsageLedger,
  type SuccessCountQuery,
  type SuccessCounter,
} from '../persistence/mongo-usage-ledger';
import { ConfigQuotaPolicy, QUOTA_WINDOW_MS } from './config-quota-policy';

// Requisito "Cuotas diarias por usuario y tarea" (specs/ai/usage-accounting) y D9 de ai-gateway-core, contra el
// MongoMemoryReplSet del preset de @linkvault/testing y contadores falsos para los fallos.

const NOW = Date.parse('2026-09-17T10:00:00.000Z');
const clock: Clock = { now: () => NOW };

class CapturingLogger implements AiLogger {
  readonly warnings: { message: string; fields?: AiLogFields }[] = [];

  debug(): void {
    // No se usa.
  }

  warn(message: string, fields?: AiLogFields): void {
    this.warnings.push({ message, fields });
  }
}

class RecordingCounter implements SuccessCounter {
  readonly queries: SuccessCountQuery[] = [];

  constructor(private readonly count: () => Promise<number>) {}

  countSuccessesSince(query: SuccessCountQuery): Promise<number> {
    this.queries.push(query);
    return this.count();
  }
}

let connection: Connection;
let ledger: MongoUsageLedger;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `ai-quota-${randomUUID()}`,
    })
    .asPromise();
  ledger = new MongoUsageLedger(connection);
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

function usage(
  userId: string,
  outcome: UsageOutcome,
  msAgo: number,
): UsageRecord {
  return {
    userId,
    task: 'classify-skills',
    providerId: 'ollama',
    model: 'qwen2.5:7b',
    inputTokens: 10,
    outputTokens: 5,
    estCost: 0,
    latencyMs: 100,
    outcome,
    promptVersion: 'v1',
    key: 'd'.repeat(64),
    at: new Date(NOW - msAgo),
  };
}

describe('ConfigQuotaPolicy', () => {
  it('Límite alcanzado', async () => {
    const userId = 'quota-reached';
    await ledger.record(usage(userId, 'success', 60_000));
    await ledger.record(usage(userId, 'success', QUOTA_WINDOW_MS - 1_000));
    const logger = new CapturingLogger();
    const policy = new ConfigQuotaPolicy({
      limits: { 'classify-skills': 2 },
      counter: ledger,
      clock,
      logger,
    });

    await expect(policy.allows(userId, 'classify-skills')).resolves.toBe(false);
    expect(logger.warnings).toEqual([]);
  });

  it('allows below the limit: older successes, other outcomes and other users do not count', async () => {
    const userId = 'quota-below';
    await ledger.record(usage(userId, 'success', 60_000));
    await ledger.record(usage(userId, 'success', QUOTA_WINDOW_MS + 1_000));
    await ledger.record(usage(userId, 'provider_error', 30_000));
    await ledger.record(usage(userId, 'quota', 20_000));
    await ledger.record(usage('someone-else', 'success', 10_000));
    const policy = new ConfigQuotaPolicy({
      limits: { 'classify-skills': 2 },
      counter: ledger,
      clock,
      logger: new CapturingLogger(),
    });

    await expect(policy.allows(userId, 'classify-skills')).resolves.toBe(true);
  });

  it('does not count for a task without a configured limit', async () => {
    const counter = new RecordingCounter(() => Promise.resolve(1_000));
    const policy = new ConfigQuotaPolicy({
      limits: { 'extract-job': 1 },
      counter,
      clock,
      logger: new CapturingLogger(),
    });

    await expect(policy.allows('any-user', 'classify-skills')).resolves.toBe(
      true,
    );
    expect(counter.queries).toEqual([]);
  });

  it('queries the last 24 hours with maxTimeMS 300', async () => {
    const counter = new RecordingCounter(() => Promise.resolve(0));
    const policy = new ConfigQuotaPolicy({
      limits: { 'classify-skills': 5 },
      counter,
      clock,
      logger: new CapturingLogger(),
    });

    await policy.allows('user-1', 'classify-skills');

    expect(counter.queries).toEqual([
      {
        userId: 'user-1',
        task: 'classify-skills',
        since: new Date(NOW - QUOTA_WINDOW_MS),
        maxTimeMS: 300,
      },
    ]);
  });

  it('Conteo no disponible', async () => {
    const logger = new CapturingLogger();
    const policy = new ConfigQuotaPolicy({
      limits: { 'classify-skills': 1 },
      counter: new RecordingCounter(() =>
        Promise.reject(new Error('MongoServerSelectionError: user-1 secret')),
      ),
      clock,
      logger,
    });

    await expect(policy.allows('user-1', 'classify-skills')).resolves.toBe(
      true,
    );
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.fields).toEqual({
      task: 'classify-skills',
      errorName: 'Error',
    });
  });

  it('allows in less than 1 second when the count never resolves', async () => {
    const logger = new CapturingLogger();
    const policy = new ConfigQuotaPolicy({
      limits: { 'classify-skills': 1 },
      counter: new RecordingCounter(() => new Promise<number>(() => undefined)),
      clock,
      logger,
    });

    const started = Date.now();
    await expect(policy.allows('user-1', 'classify-skills')).resolves.toBe(
      true,
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1_000);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.fields).toMatchObject({ timeoutMs: 300 });
  });
});
