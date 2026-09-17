import { randomUUID } from 'node:crypto';
import { getMongoTestUri, RedisPingDouble } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authPost,
  createAuthTestApp,
  refreshSetCookie,
  refreshTokenFrom,
  type AuthTestApp,
} from '../../../test-support/auth-test-app';

// `AuthController` logout (tarea 6.6 de auth-users, D4) sobre la app completa, Mongo del preset y el doble de Redis.

const PASSWORD = 'correct-horse-battery';

describe('AuthController logout', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  async function openSession(): Promise<string> {
    const response = await authPost(harness.app, 'register', {
      body: {
        email: `ana-${randomUUID()}@example.com`,
        password: PASSWORD,
        displayName: 'Ana',
      },
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    });
    const refreshToken = refreshTokenFrom(response.headers);
    if (refreshToken === undefined) {
      throw new Error('register did not set lv_refresh');
    }
    return refreshToken;
  }

  function logout(refreshToken?: string) {
    return authPost(harness.app, 'logout', { refreshToken });
  }

  function refresh(refreshToken?: string) {
    return authPost(harness.app, 'refresh', { refreshToken });
  }

  function expectClearedCookie(
    headers: Parameters<typeof refreshSetCookie>[0],
  ): void {
    const cookie = (refreshSetCookie(headers) ?? '').toLowerCase();
    expect(cookie).toMatch(/^lv_refresh=;/);
    expect(cookie).toContain('max-age=0');
    expect(cookie).toContain('path=/api/auth');
  }

  it('Logout revoca el refresh', async () => {
    const r1 = await openSession();

    const response = await logout(r1);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expectClearedCookie(response.headers);
    expect((await refresh(r1)).statusCode).toBe(401);
  });

  it('Logout sin sesión', async () => {
    const response = await logout();

    expect(response.statusCode).toBe(204);
    expectClearedCookie(response.headers);
  });

  it('answers 204 with an unknown token', async () => {
    const response = await logout('not-a-real-refresh-token');

    expect(response.statusCode).toBe(204);
    expectClearedCookie(response.headers);
  });

  it('revokes the session with an already rotated token, so its successor stops working', async () => {
    const r1 = await openSession();
    const rotated = await refresh(r1);
    const r2 = refreshTokenFrom(rotated.headers);

    const response = await logout(r1);

    expect(response.statusCode).toBe(204);
    expect((await refresh(r2)).statusCode).toBe(401);
  });

  it('requires the CSRF header like every POST /api/auth/*', async () => {
    const r1 = await openSession();

    const response = await authPost(harness.app, 'logout', {
      refreshToken: r1,
      csrf: false,
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await refresh(r1)).statusCode).toBe(200);
  });

  it('Revocación durante un refresh', async () => {
    // Varias rondas para cubrir los dos órdenes posibles entre la rotación y la revocación.
    for (let round = 0; round < 5; round += 1) {
      const r1 = await openSession();

      const [refreshed, loggedOut] = await Promise.all([
        refresh(r1),
        logout(r1),
      ]);

      expect(loggedOut.statusCode).toBe(204);
      expect([200, 401]).toContain(refreshed.statusCode);
      const successor = refreshTokenFrom(refreshed.headers);
      if (successor !== undefined) {
        expect((await refresh(successor)).statusCode).toBe(401);
      }
      expect((await refresh(r1)).statusCode).toBe(401);
    }
  });
});
