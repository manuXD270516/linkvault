import { describe, expect, it } from 'vitest';
import type { CircuitBreaker } from '../../domain/ports/circuit-breaker.port';
import type { QuotaPolicy } from '../../domain/ports/quota-policy.port';
import type { UsageRecord } from '../../domain/ports/usage-ledger.port';
import {
  AllowAllQuotaPolicy,
  EvalUsageLedger,
  NullCircuitBreaker,
  StderrAiLogger,
} from './eval-ports';

// Tarea 3.1: dobles propios del corredor (D3 de ai-eval-harness).

function usage(key: string, outcome: UsageRecord['outcome']): UsageRecord {
  return {
    task: 'classify-skills',
    providerId: outcome === 'degraded' ? null : 'ollama',
    model: null,
    inputTokens: 10,
    outputTokens: 5,
    estCost: 0,
    latencyMs: 1,
    outcome,
    promptVersion: 'v1',
    key,
    at: new Date(0),
  };
}

describe('EvalUsageLedger', () => {
  it('keeps records synchronously and filters them by key', async () => {
    const ledger = new EvalUsageLedger();
    const pending = ledger.record(usage('a', 'provider_error'));
    void ledger.record(usage('b', 'success'));
    void ledger.record(usage('a', 'degraded'));

    expect(ledger.recordsFor('a').map((r) => r.outcome)).toEqual([
      'provider_error',
      'degraded',
    ]);
    await expect(pending).resolves.toBeUndefined();
  });

  it('takes the records of a key in order and removes only them', () => {
    const ledger = new EvalUsageLedger();
    void ledger.record(usage('a', 'provider_error'));
    void ledger.record(usage('b', 'success'));
    void ledger.record(usage('a', 'degraded'));

    expect(ledger.take('a').map((r) => r.outcome)).toEqual([
      'provider_error',
      'degraded',
    ]);
    expect(ledger.take('a')).toEqual([]);
    expect(ledger.recordsFor('b')).toHaveLength(1);
  });
});

describe('AllowAllQuotaPolicy', () => {
  it('always allows', async () => {
    const quota: QuotaPolicy = new AllowAllQuotaPolicy();
    await expect(quota.allows('user', 'classify-skills')).resolves.toEqual({
      allowed: true,
    });
  });
});

describe('NullCircuitBreaker', () => {
  it('never opens, even after failures', async () => {
    const breaker: CircuitBreaker = new NullCircuitBreaker();
    for (let i = 0; i < 10; i++) await breaker.recordFailure('ollama');
    await breaker.recordSuccess('ollama');
    await breaker.release('ollama');

    expect((await breaker.openIds()).size).toBe(0);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
  });
});

describe('StderrAiLogger', () => {
  it('writes warnings as one JSON line each', () => {
    const chunks: string[] = [];
    const logger = new StderrAiLogger((chunk) => chunks.push(chunk));

    logger.warn('AI provider error', { providerId: 'ollama', httpStatus: 503 });

    expect(chunks).toEqual([
      '{"level":"warn","message":"AI provider error","providerId":"ollama","httpStatus":503}\n',
    ]);
  });

  it('drops debug unless verbose', () => {
    const quiet: string[] = [];
    new StderrAiLogger((chunk) => quiet.push(chunk)).debug('skipped');
    const verbose: string[] = [];
    new StderrAiLogger((chunk) => verbose.push(chunk), true).debug('skipped');

    expect(quiet).toEqual([]);
    expect(verbose).toEqual(['{"level":"debug","message":"skipped"}\n']);
  });
});
