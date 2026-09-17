import { apiErrorResponseSchema } from '@linkvault/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app/create-app';
import { apiTestConfig } from '../../../test-support/test-config';
import { setRefreshCookie } from './refresh-cookie';

// Hook de cabeceras de `POST /api/auth/*` (D5 de auth-users) sobre el arranque real (`createApp`), con rutas de test
// registradas directamente en Fastify: los controladores de auth llegan en 6.4+.
describe('auth POST headers hook', () => {
  let app: NestFastifyApplication;
  let handled: number;

  beforeAll(async () => {
    app = await createApp(await apiTestConfig());
    const fastify = app.getHttpAdapter().getInstance();
    // Si el hook deja pasar la petición, la ruta fija la cookie: así se ve que un rechazo no emite `Set-Cookie`.
    fastify.post('/api/auth/test-echo', async (request, reply) => {
      handled += 1;
      setRefreshCookie(reply, 'test-token', {
        expiresAt: new Date(Date.now() + 60_000),
        now: new Date(),
        secure: false,
      });
      return { body: request.body ?? null };
    });
    fastify.post('/api/other/test-echo', async (request) => {
      handled += 1;
      return { body: request.body ?? null };
    });
    fastify.get('/api/auth/test-get', async () => {
      handled += 1;
      return { ok: true };
    });
    await app.init();
    await fastify.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function post(
    url: string,
    headers: Record<string, string>,
    payload?: string,
  ): ReturnType<NestFastifyApplication['inject']> {
    handled = 0;
    return app.inject({ method: 'POST', url, headers, payload });
  }

  const csrf = { 'x-requested-with': 'linkvault' };

  it('rejects a POST without X-Requested-With with 403 csrf_header_missing and no Set-Cookie', async () => {
    const response = await post(
      '/api/auth/test-echo',
      { 'content-type': 'application/json' },
      '{"email":"ana@example.com"}',
    );

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'csrf_header_missing',
      message: expect.any(String),
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(handled).toBe(0);
  });

  it('rejects X-Requested-With with another value with 403', async () => {
    const response = await post('/api/auth/test-echo', {
      'x-requested-with': 'XMLHttpRequest',
    });

    expect(response.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it('checks the header before the content type', async () => {
    const response = await post(
      '/api/auth/test-echo',
      { 'content-type': 'text/plain' },
      'hello',
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_header_missing' });
  });

  it.each([
    ['text/plain', '{"email":"ana@example.com","password":"x"}'],
    ['application/x-www-form-urlencoded', 'email=ana%40example.com&password=x'],
    ['multipart/form-data; boundary=x', '--x\r\n\r\n--x--'],
  ])(
    'rejects a %s body with 415 unsupported_media_type and no Set-Cookie',
    async (contentType, payload) => {
      const response = await post(
        '/api/auth/test-echo',
        { ...csrf, 'content-type': contentType },
        payload,
      );

      expect(response.statusCode).toBe(415);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(apiErrorResponseSchema.parse(response.json())).toEqual({
        code: 'unsupported_media_type',
        message: expect.any(String),
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(handled).toBe(0);
    },
  );

  it('rejects a body without Content-Type with 415', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/test-echo',
      headers: csrf,
      payload: Buffer.from('{"a":1}'),
    });

    expect(response.statusCode).toBe(415);
  });

  it('lets a JSON body with the header through, including a charset parameter', async () => {
    const response = await post(
      '/api/auth/test-echo',
      { ...csrf, 'content-type': 'Application/JSON; charset=utf-8' },
      '{"email":"ana@example.com"}',
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ body: { email: 'ana@example.com' } });
    expect(response.headers['set-cookie']).toBeDefined();
    expect(handled).toBe(1);
  });

  it('lets a POST without body through with only the header (refresh and logout)', async () => {
    const response = await post('/api/auth/test-echo', csrf);

    expect(response.statusCode).toBe(200);
    expect(handled).toBe(1);
  });

  it('lets a non-JSON Content-Type without body through: there is nothing to parse', async () => {
    const response = await post('/api/auth/test-echo', {
      ...csrf,
      'content-type': 'text/plain',
      'content-length': '0',
    });

    expect(response.statusCode).toBe(200);
    expect(handled).toBe(1);
  });

  it('matches the declared route, so a percent-encoded path cannot skip the check', async () => {
    const response = await post('/api/%61uth/test-echo', {
      'content-type': 'text/plain',
    });

    expect(response.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it('ignores the query string when matching the route', async () => {
    const response = await post('/api/auth/test-echo?x=1', {});

    expect(response.statusCode).toBe(403);
  });

  it('does not apply to POST routes outside /api/auth', async () => {
    const response = await post(
      '/api/other/test-echo',
      { 'content-type': 'application/json' },
      '{"a":1}',
    );

    expect(response.statusCode).toBe(200);
    expect(handled).toBe(1);
  });

  it('does not apply to GET routes under /api/auth', async () => {
    handled = 0;
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/test-get',
    });

    expect(response.statusCode).toBe(200);
    expect(handled).toBe(1);
  });
});
