import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { REDIS_HEALTH_CLIENT } from '../infrastructure/redis/redis-health-client';
import { apiTestAiConfig, apiTestConfig } from '../test-support/test-config';
import { createApp } from './create-app';

describe('api startup with MongoDB and Redis unreachable', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('starts listening without waiting for its dependencies', async () => {
    const startedAt = Date.now();

    app = await createApp(await apiTestConfig(), apiTestAiConfig());
    await app.listen(0, '127.0.0.1');

    // Muy por debajo de serverSelectionTimeoutMS (30 s): el arranque no esperó a MongoDB.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    const response = await fetch(`${await app.getUrl()}/api/not-found`);
    expect(response.status).toBe(404);

    const mongo = app.get<Connection>(getConnectionToken());
    expect(mongo.readyState).not.toBe(1);
    const redis = app.get<Redis>(REDIS_HEALTH_CLIENT);
    expect(redis.status).not.toBe('ready');
    expect(redis.options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
  });
});
