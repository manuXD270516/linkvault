import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerApp } from '../../app/create-worker-app';
import {
  workerTestAiConfig,
  workerTestConfig,
} from '../../test-support/test-config';

describe('worker GET /metrics', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(): Promise<string> {
    app = await createWorkerApp(await workerTestConfig(), workerTestAiConfig());
    await app.listen(0, '127.0.0.1');
    return app.getUrl();
  }

  it('responds 200 with Prometheus text without credentials', async () => {
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/plain/);
    expect(body).toMatch(/# HELP/);
    expect(body).toMatch(/process_cpu/);
    expect(body).not.toMatch(/Authorization/i);
    expect(body).not.toMatch(/@example\.com/);
  });
});
