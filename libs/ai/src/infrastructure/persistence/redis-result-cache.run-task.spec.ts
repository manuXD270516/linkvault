import { RedisPingDouble } from '@linkvault/testing';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { executionKey } from '../../application/execution-key';
import { RunTask } from '../../application/run-task.usecase';
import { FakeLlmProvider } from '../../application/testing/fake-llm-provider';
import {
  InMemoryAiLogger,
  InMemoryPromptRegistry,
  InMemoryQuotaPolicy,
  InMemoryUsageLedger,
  ManualClock,
} from '../../application/testing/in-memory-ports';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import { aiCacheKey, RedisResultCache } from './redis-result-cache';
import {
  AiCacheRedisConnection,
  createAiCacheRedisClient,
} from './redis-result-cache.client';

// Tarea 11.3, escenario "Entrada de caché" (specs/ai/data-protection, D8): runTask con RedisResultCache real contra
// el doble RESP de @linkvault/testing y un proveedor falso que no es el mock, para que la caché se use.

const INPUT = {
  text: 'Ana Pérez, ana.perez@example.com: backend con TypeScript y NestJS',
};
const OUTPUT = {
  skills: [
    { name: 'TypeScript', category: 'language' },
    { name: 'NestJS', category: 'framework' },
  ],
};

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function whenReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => client.once('ready', () => resolve()));
}

/**
 * Un proceso lógico: cliente Redis propio, `RedisResultCache` propia y `RunTask` independiente sobre `provider`, con
 * los demás puertos en memoria y también propios.
 */
async function startRunTaskProcess(
  url: string,
  provider: FakeLlmProvider,
): Promise<RunTask> {
  const logger = new InMemoryAiLogger();
  const client = createAiCacheRedisClient(url);
  const connection = new AiCacheRedisConnection(client, logger);
  connection.onModuleInit();
  cleanups.push(() => connection.onApplicationShutdown());
  await whenReady(client);
  const clock = new ManualClock();
  return new RunTask({
    providers: [provider],
    prompts: new InMemoryPromptRegistry(),
    cache: new RedisResultCache(client),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new InMemoryCircuitBreaker(clock),
    clock,
    logger,
  });
}

describe('runTask with the Redis result cache', () => {
  it('Entrada de caché', async () => {
    const double = await RedisPingDouble.start('up');
    cleanups.push(() => double.close());
    const logger = new InMemoryAiLogger();
    const client = createAiCacheRedisClient(double.url);
    const connection = new AiCacheRedisConnection(client, logger);
    connection.onModuleInit();
    cleanups.push(() => connection.onApplicationShutdown());
    await whenReady(client);

    const clock = new ManualClock();
    const prompts = new InMemoryPromptRegistry();
    const provider = new FakeLlmProvider('ollama', [JSON.stringify(OUTPUT)], {
      model: 'qwen2.5:7b',
    });
    const runTask = new RunTask({
      providers: [provider],
      prompts,
      cache: new RedisResultCache(client),
      ledger: new InMemoryUsageLedger(),
      quota: new InMemoryQuotaPolicy(),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      logger,
    });
    const ctx = { aiConsent: { externalProviders: false } };

    const first = await runTask.execute(classifySkillsTask, INPUT, ctx);
    expect(first).toMatchObject({ status: 'success', cached: false });

    // Lectura directa de la entrada con un cliente ioredis independiente.
    const reader = new Redis(double.url, {
      lazyConnect: true,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
    });
    cleanups.push(() => reader.disconnect());
    await reader.connect();
    const key = executionKey({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: INPUT,
    });
    const raw = await reader.get(aiCacheKey(key));

    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? 'null') as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      'model',
      'output',
      'promptVersion',
      'providerId',
    ]);
    expect(stored).toEqual({
      output: OUTPUT,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      promptVersion: 'v1',
    });
    // Ni el input ni el prompt renderizado llegan al almacén.
    expect(raw).not.toContain('ana.perez@example.com');
    expect(raw).not.toContain(INPUT.text);
    for (const prompt of prompts.rendered) {
      expect(raw).not.toContain(prompt.system);
      expect(raw).not.toContain(prompt.user);
    }

    // La segunda ejecución se sirve desde Redis sin contactar al proveedor.
    const second = await runTask.execute(classifySkillsTask, INPUT, ctx);
    expect(second).toEqual({
      status: 'success',
      output: OUTPUT,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      promptVersion: 'v1',
      cached: true,
    });
    expect(provider.calls).toBe(1);
  });

  it('Caché compartida entre procesos', async () => {
    const double = await RedisPingDouble.start('up');
    cleanups.push(() => double.close());
    const ctx = { aiConsent: { externalProviders: false } };
    const writerProvider = new FakeLlmProvider(
      'ollama',
      [JSON.stringify(OUTPUT)],
      { model: 'qwen2.5:7b' },
    );
    const readerProvider = new FakeLlmProvider(
      'ollama',
      [JSON.stringify({ skills: [] })],
      { model: 'other-model' },
    );
    const writer = await startRunTaskProcess(double.url, writerProvider);
    const reader = await startRunTaskProcess(double.url, readerProvider);

    const first = await writer.execute(classifySkillsTask, INPUT, ctx);
    const second = await reader.execute(classifySkillsTask, INPUT, ctx);

    expect(first).toMatchObject({ status: 'success', cached: false });
    expect(writerProvider.calls).toBe(1);
    expect(second).toEqual({
      status: 'success',
      output: OUTPUT,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      promptVersion: 'v1',
      cached: true,
    });
    expect(readerProvider.calls).toBe(0);
  });
});
