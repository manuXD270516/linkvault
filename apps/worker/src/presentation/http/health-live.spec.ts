import { healthLiveResponseSchema } from '@linkvault/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerApp } from '../../app/create-worker-app';
import { PACKAGE_VERSION } from '../../infrastructure/app-version';
import { workerTestConfig } from '../../test-support/test-config';

describe('worker GET /health/live', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(appVersion?: string): Promise<string> {
    // Mongo y Redis apuntan a puertos cerrados: la liveness no depende de ellos.
    const config = await workerTestConfig({ APP_VERSION: appVersion });
    app = await createWorkerApp(config);
    await app.listen(config.WORKER_HEALTH_PORT, '127.0.0.1');
    return `http://127.0.0.1:${config.WORKER_HEALTH_PORT}`;
  }

  it('responds 200 in under a second on WORKER_HEALTH_PORT without credentials while MongoDB and Redis are down', async () => {
    const baseUrl = await start();

    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/health/live`);
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(1_000);
    expect(healthLiveResponseSchema.parse(await response.json())).toEqual({
      status: 'up',
      service: 'worker',
      version: PACKAGE_VERSION,
    });
  });

  it('reports APP_VERSION when it is set', async () => {
    const baseUrl = await start('1.2.3-test');

    const response = await fetch(`${baseUrl}/health/live`);

    expect(await response.json()).toMatchObject({ version: '1.2.3-test' });
  });
});
