import { getMongoTestUri } from '@linkvault/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_PAGE_SECURITY_HEADERS } from '../modules/links/presentation/public-page/public-page.headers';
import {
  createLinksTestApp,
  type LinksTestApp,
} from '../test-support/links-test-app';
import { apiTestAiConfig, apiTestConfig } from '../test-support/test-config';
import { createApp } from './create-app';
import { API_SECURITY_HEADERS } from '../presentation/http/security-headers';

// Cabeceras de seguridad de la API (D6 de edge-security-headers, ADR-057) sobre la aplicación real y `app.inject`.

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function expectApiHeaders(headers: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    expect(headers[name.toLowerCase()], name).toBe(value);
  }
}

describe('API security headers', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // Mongo y Redis apuntan a puertos cerrados: ninguna de estas rutas los necesita.
    app = await createApp(
      await apiTestConfig({ EXTENSION_CORS_ORIGINS: [EXTENSION_ORIGIN] }),
      apiTestAiConfig(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a JSON 200 carries the API security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expectApiHeaders(response.headers);
  });

  it('an unknown /api route (404) carries the API security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/no-existe' });

    expect(response.statusCode).toBe(404);
    expectApiHeaders(response.headers);
  });

  it('the auth CSRF rejection (403) carries the API security headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expectApiHeaders(response.headers);
  });

  it('a validation error (400) carries the API security headers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'linkvault',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expectApiHeaders(response.headers);
  });

  it('the extension CORS preflight carries the API security headers', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/links',
      headers: {
        origin: EXTENSION_ORIGIN,
        'access-control-request-method': 'POST',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBe(
      EXTENSION_ORIGIN,
    );
    expectApiHeaders(response.headers);
  });

  it('the API never sends Strict-Transport-Security', async () => {
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/health/live' }),
      app.inject({ method: 'GET', url: '/api/no-existe' }),
    ]);

    for (const response of responses) {
      expect(response.headers['strict-transport-security']).toBeUndefined();
    }
  });
});

describe('API security headers on the public page', () => {
  let http: LinksTestApp;

  beforeAll(async () => {
    http = await createLinksTestApp('edge-security-headers', getMongoTestUri());
  });

  afterAll(async () => {
    await http.close();
  });

  function expectPublicPageHeaders(headers: Record<string, unknown>): void {
    expect(headers['content-security-policy']).toBe(
      PUBLIC_PAGE_SECURITY_HEADERS['Content-Security-Policy'],
    );
    expect(headers['referrer-policy']).toBe(
      PUBLIC_PAGE_SECURITY_HEADERS['Referrer-Policy'],
    );
    expect(headers['x-frame-options']).toBe('DENY');
  }

  it('the public page keeps its own CSP and Referrer-Policy and gains X-Frame-Options', async () => {
    const owner = await http.authenticated('Ana');
    const group = await http.createGroup(owner, 'Backend Bolivia');
    const saved = await http.request('POST', '/api/links', {
      authorization: owner.authorization,
      body: {
        url: 'https://www.linkedin.com/jobs/view/3811111111/',
        groupId: group.id,
      },
    });
    expect(saved.statusCode).toBe(201);
    const slug = saved.json<{ link: { publicShare?: { slug: string } } }>().link
      .publicShare?.slug;
    expect(slug).toBeDefined();

    const published = await http.request('GET', `/p/${slug}`);
    const missing = await http.request('GET', '/p/zzzzzzzzzzzz');

    expect(published.statusCode).toBe(200);
    expect(missing.statusCode).toBe(404);
    expectPublicPageHeaders(published.headers);
    expectPublicPageHeaders(missing.headers);
  });
});
