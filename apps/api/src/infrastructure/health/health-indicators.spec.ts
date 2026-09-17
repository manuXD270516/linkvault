import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { MongoHealthIndicator } from './mongo-health.indicator';
import { RedisHealthIndicator } from './redis-health.indicator';
import { HEALTH_CHECK_TIMEOUT_MS } from './with-timeout';

type Behaviour = 'up' | 'down' | 'hang';

const DRIVER_MESSAGE =
  'connect ECONNREFUSED mongodb://lv-user:lv-s3cr3t@127.0.0.1:1';

function outcome<T>(behaviour: Behaviour, value: T): () => Promise<T> {
  return () => {
    if (behaviour === 'up') {
      return Promise.resolve(value);
    }
    if (behaviour === 'down') {
      return Promise.reject(new Error(DRIVER_MESSAGE));
    }
    return new Promise<T>(() => undefined);
  };
}

function mongoIndicator(behaviour: Behaviour): MongoHealthIndicator {
  const command = outcome(behaviour, { ok: 1 });
  const connection = {
    getClient: () => ({ db: () => ({ admin: () => ({ command }) }) }),
  } as unknown as Connection;
  return new MongoHealthIndicator(connection, new HealthIndicatorService());
}

function redisIndicator(behaviour: Behaviour): RedisHealthIndicator {
  const client = { ping: outcome(behaviour, 'PONG') } as unknown as Redis;
  return new RedisHealthIndicator(client, new HealthIndicatorService());
}

const INDICATORS = [
  { name: 'mongo', create: mongoIndicator },
  { name: 'redis', create: redisIndicator },
] as const;

describe.each(INDICATORS)('$name health indicator', ({ name, create }) => {
  it('reports up when the dependency answers', async () => {
    await expect(create('up').isHealthy(name)).resolves.toEqual({
      [name]: { status: 'up' },
    });
  });

  it('reports down without the driver message when the dependency fails', async () => {
    const result = await create('down').isHealthy(name);

    expect(result).toEqual({ [name]: { status: 'down' } });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });

  it('reports down after the timeout when the dependency hangs', async () => {
    const startedAt = Date.now();

    const result = await create('hang').isHealthy(name);

    const elapsed = Date.now() - startedAt;
    expect(result).toEqual({ [name]: { status: 'down' } });
    expect(elapsed).toBeGreaterThanOrEqual(HEALTH_CHECK_TIMEOUT_MS - 20);
    expect(elapsed).toBeLessThan(HEALTH_CHECK_TIMEOUT_MS + 300);
  });
});
