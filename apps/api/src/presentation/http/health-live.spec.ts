import { healthLiveResponseSchema } from '@linkvault/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app/create-app';
import { PACKAGE_VERSION } from '../../infrastructure/app-version';
import { apiTestAiConfig, apiTestConfig } from '../../test-support/test-config';

describe('api GET /health/live', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(appVersion?: string): Promise<string> {
    // Mongo y Redis apuntan a puertos cerrados: la liveness no depende de ellos.
    app = await createApp(
      await apiTestConfig({ APP_VERSION: appVersion }),
      apiTestAiConfig(),
    );
    await app.listen(0, '127.0.0.1');
    return app.getUrl();
  }

  it('responds 200 in under a second without credentials while MongoDB and Redis are down', async () => {
    const baseUrl = await start();

    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/health/live`);
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(1_000);
    expect(healthLiveResponseSchema.parse(await response.json())).toEqual({
      status: 'up',
      service: 'api',
      version: PACKAGE_VERSION,
    });
  });

  it('reports APP_VERSION when it is set', async () => {
    const baseUrl = await start('1.2.3-test');

    const response = await fetch(`${baseUrl}/health/live`);

    expect(await response.json()).toMatchObject({ version: '1.2.3-test' });
  });

  it('is served outside the /api prefix', async () => {
    const baseUrl = await start();

    const prefixed = await fetch(`${baseUrl}/api/health/live`);

    expect(prefixed.status).toBe(404);
  });
});
