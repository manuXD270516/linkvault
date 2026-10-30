import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerApp } from '../../app/create-worker-app';
import { PrometheusCvExtractionMetrics } from '../../modules/cv/infrastructure/isolation/cv-extraction.metrics';
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

  it('exposes linkvault_cv_extractions_total', async () => {
    new PrometheusCvExtractionMetrics().record('pdf', {
      outcome: 'unreadable',
      cause: 'timeout',
    });
    const baseUrl = await start();

    const body = await (await fetch(`${baseUrl}/metrics`)).text();

    expect(body).toMatch(/# TYPE linkvault_cv_extractions_total counter/);
    expect(body).toMatch(
      /linkvault_cv_extractions_total\{format="pdf",outcome="unreadable",cause="timeout"\} \d+/,
    );
  });

  it('metrics carry no cv text nor file name', async () => {
    // Las lecturas con texto y nombre marcados se hacen en `pathological.spec.ts` (proyecto `worker-isolation`), que
    // comprueba el mismo registro; aquí se comprueba el cuerpo que sirve `GET /metrics`.
    new PrometheusCvExtractionMetrics().record('docx', {
      outcome: 'text',
      cause: 'none',
    });
    const baseUrl = await start();

    const body = await (await fetch(`${baseUrl}/metrics`)).text();

    expect(body).not.toContain('CANARY-CV-TEXT');
    expect(body).not.toContain('CANARY_FILE');
    expect(body).not.toMatch(
      /linkvault_cv_extractions_total\{[^}]*(file|name|text|key)=/,
    );
  });
});
