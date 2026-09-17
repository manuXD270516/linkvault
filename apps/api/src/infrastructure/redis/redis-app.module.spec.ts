import { RedisPingDouble } from '@linkvault/testing';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { apiTestConfig } from '../../test-support/test-config';
import { AppConfigModule } from '../config/app-config.module';
import {
  createRedisAppClient,
  REDIS_APP_CLIENT,
  REDIS_APP_COMMAND_TIMEOUT_MS,
} from './redis-app-client';
import { RedisAppModule } from './redis-app.module';
import { REDIS_HEALTH_CLIENT } from './redis-health-client';

// Conexión Redis de aplicación (D7 de auth-users): cliente ioredis propio, distinto del de salud.

const doubles: RedisPingDouble[] = [];
const modules: TestingModule[] = [];

afterEach(async () => {
  for (const moduleRef of modules.splice(0)) {
    await moduleRef.close();
  }
  for (const double of doubles.splice(0)) {
    await double.close();
  }
});

async function compile(redisUrl?: string): Promise<TestingModule> {
  const config = await apiTestConfig(redisUrl ? { REDIS_URL: redisUrl } : {});
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule.forRoot(config), RedisAppModule],
  }).compile();
  modules.push(moduleRef);
  return moduleRef;
}

function whenReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => client.once('ready', () => resolve()));
}

describe('RedisAppModule', () => {
  it('creates a lazy client that fails fast instead of queueing', () => {
    const client = createRedisAppClient('redis://127.0.0.1:6379');

    expect(client.status).toBe('wait');
    expect(REDIS_APP_COMMAND_TIMEOUT_MS).toBe(200);
    expect(client.options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      commandTimeout: 200,
    });
    client.disconnect();
  });

  it('connects in the background on init and disconnects on shutdown', async () => {
    const double = await RedisPingDouble.start('up');
    doubles.push(double);
    const moduleRef = await compile(double.url);
    const client = moduleRef.get<Redis>(REDIS_APP_CLIENT);

    await moduleRef.init();
    await whenReady(client);
    await expect(client.ping()).resolves.toBe('PONG');

    const ended = new Promise<void>((resolve) =>
      client.once('end', () => resolve()),
    );
    modules.splice(modules.indexOf(moduleRef), 1);
    await moduleRef.close();
    await ended;
    expect(client.status).toBe('end');
  });

  it('is a different client from the health one', async () => {
    const moduleRef = await compile();

    expect(() => moduleRef.get(REDIS_HEALTH_CLIENT)).toThrow();
    expect(moduleRef.get(REDIS_APP_CLIENT)).toBeDefined();
  });

  it('initializes without throwing when Redis is unreachable and rejects commands at once', async () => {
    const moduleRef = await compile();
    const client = moduleRef.get<Redis>(REDIS_APP_CLIENT);

    await expect(moduleRef.init()).resolves.toBeDefined();
    const startedAt = Date.now();
    await expect(client.ping()).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
