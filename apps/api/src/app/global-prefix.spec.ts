import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTestAiConfig, apiTestConfig } from '../test-support/test-config';
import { createApp, PUBLIC_PAGE_ROUTES } from './create-app';

describe('api global prefix', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(await apiTestConfig(), apiTestAiConfig());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // La página pública se sirve fuera del prefijo (D4 de public-preview-share). `setGlobalPrefix` compara rutas, así que
  // se excluyen las **tres** formas, y el comodín va como `p/{*splat}`: `'p/*'` no es válido en `path-to-regexp` 8 y
  // habría roto el arranque, que este `beforeAll` ya ejercita.
  it('excluye las tres formas de la página pública del prefijo', () => {
    expect(PUBLIC_PAGE_ROUTES).toEqual(['p', 'p/:slug', 'p/{*splat}']);
    expect(PUBLIC_PAGE_ROUTES).not.toContain('p/*');
  });

  it('no sirve la página pública bajo el prefijo', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/p/k7m2p9r4t6vw',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
  });

  it('answers an unknown /api route with the Nest 404 JSON', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/does-not-exist',
    });
  });
});
