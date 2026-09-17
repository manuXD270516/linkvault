import { RUN_TASK, type RunTaskFn } from '@linkvault/ai';
import { getSharedConfigToken } from '@nestjs/bullmq';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { REDIS_HEALTH_CLIENT } from '../infrastructure/redis/redis-health-client';
import {
  workerTestAiConfig,
  workerTestConfig,
} from '../test-support/test-config';
import { createWorkerApp } from './create-worker-app';

describe('worker startup with MongoDB and Redis unreachable', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('listens on WORKER_HEALTH_PORT without waiting for its dependencies', async () => {
    const config = await workerTestConfig();
    const startedAt = Date.now();

    app = await createWorkerApp(config, workerTestAiConfig());
    await app.listen(config.WORKER_HEALTH_PORT, '127.0.0.1');

    // Muy por debajo de serverSelectionTimeoutMS (30 s): el arranque no esperó a MongoDB ni a Redis.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    const response = await fetch(
      `http://127.0.0.1:${config.WORKER_HEALTH_PORT}/not-found`,
    );
    expect(response.status).toBe(404);

    expect(app.get<Connection>(getConnectionToken()).readyState).not.toBe(1);
    expect(app.get<Redis>(REDIS_HEALTH_CLIENT).status).not.toBe('ready');
    expect(typeof app.get<RunTaskFn>(RUN_TASK)).toBe('function');
    expect(app.get(getSharedConfigToken())).toMatchObject({
      connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
    });
  });
});
