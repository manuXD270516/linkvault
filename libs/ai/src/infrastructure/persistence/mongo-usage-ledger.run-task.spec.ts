import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RunTask } from '../../application/run-task.usecase';
import { FakeLlmProvider } from '../../application/testing/fake-llm-provider';
import {
  InMemoryAiLogger,
  InMemoryPromptRegistry,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  ManualClock,
} from '../../application/testing/in-memory-ports';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import { MongoUsageLedger } from './mongo-usage-ledger';

// Tarea 9.5, escenario "Ledger no disponible" (specs/ai/usage-accounting, requisito "Registro no bloqueante"):
// runTask con un proveedor falso de latencia 0 y el ledger de Mongo real sobre una conexión sin servidor.

/** Puerto 1: nadie escucha; la conexión nunca llega a abrirse. */
const UNREACHABLE_URI = 'mongodb://127.0.0.1:1/ai-ledger-unavailable';

let connection: Connection;

beforeAll(() => {
  connection = mongoose.createConnection(UNREACHABLE_URI, {
    serverSelectionTimeoutMS: 1_500,
  });
  // Sin servidor la conexión falla: se ignora aquí, igual que en la app con conexiones perezosas (ADR-017 §6).
  connection.on('error', () => undefined);
  connection.asPromise().catch(() => undefined);
});

afterAll(async () => {
  await connection.close(true);
});

describe('runTask with the Mongo ledger unavailable', () => {
  it('Ledger no disponible', async () => {
    const clock = new ManualClock();
    const logger = new InMemoryAiLogger();
    const provider = new FakeLlmProvider(
      'ollama',
      ['{"skills":[{"name":"TypeScript","category":"language"}]}'],
      { latencyMs: 0 },
    );
    const runTask = new RunTask({
      providers: [provider],
      prompts: new InMemoryPromptRegistry(),
      cache: new InMemoryResultCache(),
      ledger: new MongoUsageLedger(connection),
      quota: new InMemoryQuotaPolicy(),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      logger,
    });

    const startedAt = performance.now();
    const result = await runTask.execute(
      classifySkillsTask,
      { text: 'TypeScript' },
      { aiConsent: { externalProviders: false }, userId: 'user-1' },
    );
    const elapsedMs = performance.now() - startedAt;

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
    expect(elapsedMs).toBeLessThan(1_000);
    expect(connection.readyState).not.toBe(mongoose.ConnectionStates.connected);
    // La escritura fallida llega al logger como aviso, sin afectar al resultado.
    await vi.waitFor(
      () => {
        expect(logger.warnings.map((w) => w.message)).toContain(
          'AI usage ledger write failed',
        );
      },
      { timeout: 4_000 },
    );
  });
});
