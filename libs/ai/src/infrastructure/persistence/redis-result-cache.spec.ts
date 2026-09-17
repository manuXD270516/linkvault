import { RedisPingDouble } from '@linkvault/testing';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAiLogger } from '../../application/testing/in-memory-ports';
import type { CachedResult } from '../../domain/ports/result-cache.port';
import {
  AiCacheRedisConnection,
  aiCacheRedisRetryDelay,
  createAiCacheRedisClient,
} from './redis-result-cache.client';
import { AI_CACHE_KEY_PREFIX, RedisResultCache } from './redis-result-cache';

// Requisito "Caché de resultados" (specs/ai/task-execution) y D8 de ai-gateway-core, contra el doble RESP de
// @linkvault/testing.

const KEY = 'a'.repeat(64);

const entry: CachedResult = {
  output: { skills: [{ name: 'TypeScript', category: 'language' }] },
  providerId: 'ollama',
  model: 'qwen2.5:7b',
  promptVersion: 'v1',
};

interface Process {
  client: Redis;
  connection: AiCacheRedisConnection;
  logger: InMemoryAiLogger;
}

const doubles: RedisPingDouble[] = [];
const processes: Process[] = [];

async function startDouble(): Promise<RedisPingDouble> {
  const double = await RedisPingDouble.start('up');
  doubles.push(double);
  return double;
}

/** Simula un proceso: cliente propio y conexión arrancada como en onModuleInit. */
function startProcess(url: string): Process {
  const client = createAiCacheRedisClient(url);
  const logger = new InMemoryAiLogger();
  const connection = new AiCacheRedisConnection(client, logger);
  connection.onModuleInit();
  const started = { client, connection, logger };
  processes.push(started);
  return started;
}

function whenReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => client.once('ready', () => resolve()));
}

async function timed<T>(
  work: Promise<T>,
): Promise<{ value: T; elapsed: number }> {
  const started = Date.now();
  const value = await work;
  return { value, elapsed: Date.now() - started };
}

afterEach(async () => {
  for (const p of processes.splice(0)) p.connection.onApplicationShutdown();
  await Promise.all(doubles.splice(0).map((d) => d.close()));
});

describe('RedisResultCache', () => {
  it('Caché compartida entre procesos', async () => {
    const double = await startDouble();
    const first = startProcess(double.url);
    const second = startProcess(double.url);
    await Promise.all([whenReady(first.client), whenReady(second.client)]);
    const writer = new RedisResultCache(first.client);
    const reader = new RedisResultCache(second.client);

    expect(await reader.get(KEY)).toBeNull();
    await writer.set(KEY, entry);

    expect(await reader.get(KEY)).toEqual(entry);
    expect(await second.client.get(`${AI_CACHE_KEY_PREFIX}${KEY}`)).toBe(
      JSON.stringify(entry),
    );
  });

  it('stores only output, providerId, model and promptVersion', async () => {
    const double = await startDouble();
    const { client } = startProcess(double.url);
    await whenReady(client);
    const cache = new RedisResultCache(client);

    await cache.set(KEY, {
      ...entry,
      prompt: 'rendered prompt with ana@example.com',
      input: { text: 'ana@example.com' },
    } as CachedResult);

    const raw = await client.get(`ai:cache:v1:${KEY}`);
    expect(Object.keys(JSON.parse(raw ?? '{}') as object).sort()).toEqual([
      'model',
      'output',
      'promptVersion',
      'providerId',
    ]);
    expect(raw).not.toContain('ana@example.com');
  });

  it('expires entries after the configured TTL', async () => {
    const double = await startDouble();
    const { client } = startProcess(double.url);
    await whenReady(client);
    const cache = new RedisResultCache(client, { ttlSeconds: 0.05 });

    await cache.set(KEY, entry);
    expect(await cache.get(KEY)).toEqual(entry);

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await cache.get(KEY)).toBeNull();
  });

  it('treats a malformed entry as a cache miss', async () => {
    const double = await startDouble();
    const { client } = startProcess(double.url);
    await whenReady(client);
    const cache = new RedisResultCache(client);

    await client.set(`ai:cache:v1:${KEY}`, 'not json');
    expect(await cache.get(KEY)).toBeNull();
    await client.set(`ai:cache:v1:${KEY}`, JSON.stringify({ output: 1 }));
    expect(await cache.get(KEY)).toBeNull();
  });

  it('does not throw on read or write when the double is stopped after connecting', async () => {
    const double = await startDouble();
    const { client, logger } = startProcess(double.url);
    await whenReady(client);
    const cache = new RedisResultCache(client);
    await cache.set(KEY, entry);

    await double.setMode('stop');

    const started = Date.now();
    await expect(cache.get(KEY)).resolves.toBeNull();
    await expect(cache.set(KEY, entry)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(logger.warnings.length).toBeLessThanOrEqual(1);
    for (const warning of logger.warnings) {
      expect(JSON.stringify(warning)).not.toContain(double.url);
    }
  });

  it('does not throw when the double is stopped before the client ever connects', async () => {
    const double = await startDouble();
    const { url } = double;
    await double.setMode('stop');
    const { client, logger } = startProcess(url);
    const cache = new RedisResultCache(client);

    await expect(cache.get(KEY)).resolves.toBeNull();
    await expect(cache.set(KEY, entry)).resolves.toBeUndefined();
    await expect.poll(() => logger.warnings.length).toBe(1);
  });

  it('does not hang on read or write when the double accepts connections and never answers', async () => {
    // Sin respuesta al handshake el cliente nunca llega a `ready`: sin cola offline, los comandos fallan enseguida.
    const double = await RedisPingDouble.start('hang');
    doubles.push(double);
    const { client } = startProcess(double.url);
    const cache = new RedisResultCache(client);

    const [read, write] = await Promise.all([
      timed(cache.get(KEY)),
      timed(cache.set(KEY, entry)),
    ]);

    expect(read.value).toBeNull();
    expect(write.value).toBeUndefined();
    expect(read.elapsed).toBeLessThan(1_000);
    expect(write.elapsed).toBeLessThan(1_000);
  });

  it('times out read and write after 500 ms when a connected Redis stops answering', async () => {
    const double = await startDouble();
    const { client } = startProcess(double.url);
    await whenReady(client);
    const cache = new RedisResultCache(client);
    await double.setMode('hang');

    const [read, write] = await Promise.all([
      timed(cache.get(KEY)),
      timed(cache.set(KEY, entry)),
    ]);

    expect(client.status).toBe('ready');
    expect(read.value).toBeNull();
    expect(write.value).toBeUndefined();
    for (const { elapsed } of [read, write]) {
      expect(elapsed).toBeGreaterThanOrEqual(450);
      expect(elapsed).toBeLessThan(1_000);
    }
  });

  it('backs off exponentially up to 2 seconds', () => {
    expect([1, 2, 3, 4, 10].map(aiCacheRedisRetryDelay)).toEqual([
      250, 500, 1000, 2000, 2000,
    ]);
  });
});
