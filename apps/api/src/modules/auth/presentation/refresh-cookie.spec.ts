import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app/create-app';
import {
  apiTestAiConfig,
  apiTestConfig,
} from '../../../test-support/test-config';
import {
  clearRefreshCookie,
  isRefreshCookieSecure,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  setRefreshCookie,
} from './refresh-cookie';

const NOW = new Date('2026-09-17T10:00:00.000Z');
/** 30 días y medio segundo: `Max-Age` redondea hacia abajo para no sobrevivir al token. */
const EXPIRES_AT = new Date(NOW.getTime() + 30 * 24 * 3600 * 1000 + 500);
const THIRTY_DAYS_SECONDS = 30 * 24 * 3600;

/** Atributos de una cabecera `Set-Cookie`, con nombres en minúsculas. */
function parseSetCookie(header: string): {
  name: string;
  value: string;
  attributes: Map<string, string>;
} {
  const [pair = '', ...rest] = header.split(';').map((part) => part.trim());
  const separator = pair.indexOf('=');
  const attributes = new Map<string, string>();
  for (const attribute of rest) {
    const [key = '', value = ''] = attribute.split('=');
    attributes.set(key.toLowerCase(), value);
  }
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    attributes,
  };
}

function singleSetCookie(header: string | string[] | undefined): string {
  expect(typeof header).toBe('string');
  return header as string;
}

// Cookie `lv_refresh` (D5 de auth-users) serializada por `@fastify/cookie` registrado en `configureApp`.
describe('refresh cookie', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(await apiTestConfig(), apiTestAiConfig());
    const fastify = app.getHttpAdapter().getInstance();
    fastify.get<{ Querystring: { secure?: string } }>(
      '/api/auth/test-set',
      async (request, reply) => {
        setRefreshCookie(reply, 'r1-token_value', {
          expiresAt: EXPIRES_AT,
          now: NOW,
          secure: request.query.secure === 'true',
        });
        return { ok: true };
      },
    );
    fastify.get('/api/auth/test-set-expired', async (_request, reply) => {
      setRefreshCookie(reply, 'r1', {
        expiresAt: new Date(NOW.getTime() - 1_000),
        now: NOW,
        secure: false,
      });
      return { ok: true };
    });
    fastify.get<{ Querystring: { secure?: string } }>(
      '/api/auth/test-clear',
      async (request, reply) => {
        clearRefreshCookie(reply, { secure: request.query.secure === 'true' });
        return { ok: true };
      },
    );
    fastify.get('/api/auth/test-read', async (request) => ({
      token: readRefreshCookie(request) ?? null,
    }));
    await app.init();
    await fastify.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is Secure only with NODE_ENV=production', () => {
    expect(isRefreshCookieSecure('production')).toBe(true);
    expect(isRefreshCookieSecure('development')).toBe(false);
    expect(isRefreshCookieSecure('test')).toBe(false);
  });

  it('sets lv_refresh with HttpOnly, SameSite=Lax, Path=/api/auth and Max-Age until expiry, without Secure outside production', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/test-set',
    });

    const cookie = parseSetCookie(
      singleSetCookie(response.headers['set-cookie']),
    );
    expect(cookie.name).toBe(REFRESH_COOKIE_NAME);
    expect(cookie.value).toBe('r1-token_value');
    expect(cookie.attributes.get('max-age')).toBe(String(THIRTY_DAYS_SECONDS));
    expect(cookie.attributes.has('httponly')).toBe(true);
    expect(cookie.attributes.get('samesite')).toBe('Lax');
    expect(cookie.attributes.get('path')).toBe('/api/auth');
    expect(cookie.attributes.has('secure')).toBe(false);
    expect(cookie.attributes.has('domain')).toBe(false);
  });

  it('adds Secure in production', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/test-set?secure=true',
    });

    const cookie = parseSetCookie(
      singleSetCookie(response.headers['set-cookie']),
    );
    expect(cookie.attributes.has('secure')).toBe(true);
    expect(cookie.attributes.has('httponly')).toBe(true);
  });

  it('never sets a negative Max-Age', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/test-set-expired',
    });

    const cookie = parseSetCookie(
      singleSetCookie(response.headers['set-cookie']),
    );
    expect(cookie.attributes.get('max-age')).toBe('0');
  });

  it.each([
    ['outside production', 'false', false],
    ['in production', 'true', true],
  ])(
    'clears lv_refresh %s with the same Path and Max-Age=0',
    async (_label, secure, expectSecure) => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/auth/test-clear?secure=${secure}`,
      });

      const cookie = parseSetCookie(
        singleSetCookie(response.headers['set-cookie']),
      );
      expect(cookie.name).toBe(REFRESH_COOKIE_NAME);
      expect(cookie.value).toBe('');
      expect(cookie.attributes.get('max-age')).toBe('0');
      expect(cookie.attributes.get('path')).toBe('/api/auth');
      expect(cookie.attributes.has('httponly')).toBe(true);
      expect(cookie.attributes.get('samesite')).toBe('Lax');
      expect(cookie.attributes.has('secure')).toBe(expectSecure);
    },
  );

  it('reads lv_refresh from the request cookies', async () => {
    const withCookie = await app.inject({
      method: 'GET',
      url: '/api/auth/test-read',
      cookies: { [REFRESH_COOKIE_NAME]: 'r1', other: 'x' },
    });
    const withoutCookie = await app.inject({
      method: 'GET',
      url: '/api/auth/test-read',
      cookies: { other: 'x' },
    });
    const emptyCookie = await app.inject({
      method: 'GET',
      url: '/api/auth/test-read',
      cookies: { [REFRESH_COOKIE_NAME]: '' },
    });

    expect(withCookie.json()).toEqual({ token: 'r1' });
    expect(withoutCookie.json()).toEqual({ token: null });
    expect(emptyCookie.json()).toEqual({ token: null });
  });
});
