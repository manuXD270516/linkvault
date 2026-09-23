import { getMongoTestUri, RedisPingDouble } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAuthTestApp,
  type AuthTestApp,
} from '../../../test-support/auth-test-app';

// CORS allowlist de extensión (ADR-038 / task 2.3): default vacío = off; origen allowlisted recibe ACAO.

const ALLOWED = 'chrome-extension://abcdefghijklmnopqrstuvwxyz123456';
const OTHER = 'chrome-extension://otherid0123456789abcdefghijklmnop';

describe('EXTENSION_CORS_ORIGINS', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
      config: { EXTENSION_CORS_ORIGINS: [ALLOWED] },
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  it('preflight allowlisted OK', async () => {
    const response = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/auth/extension/login',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers':
          'authorization,content-type,x-requested-with',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(response.headers['access-control-allow-methods']).toMatch(/POST/i);
  });

  it('otro origen sin ACAO', async () => {
    const response = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/auth/extension/login',
      headers: {
        origin: OTHER,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('EXTENSION_CORS_ORIGINS vacío', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
      config: { EXTENSION_CORS_ORIGINS: [] },
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  it('default vacío = CORS off', async () => {
    const response = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/auth/extension/login',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
