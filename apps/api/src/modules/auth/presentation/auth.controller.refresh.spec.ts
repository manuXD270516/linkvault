import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  sessionResponseSchema,
} from '@linkvault/shared';
import { getMongoTestUri, RedisPingDouble } from '@linkvault/testing';
import { Logger } from '@nestjs/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  authPost,
  createAuthTestApp,
  refreshSetCookie,
  refreshTokenFrom,
  type AuthTestApp,
} from '../../../test-support/auth-test-app';

// `AuthController` refresh (tarea 6.5 de auth-users, D4) sobre la app completa, Mongo del preset y el doble de Redis. El
// reloj de `auth` se adelanta para cruzar la ventana de conflicto de 10 s sin esperar.

const PASSWORD = 'correct-horse-battery';

describe('AuthController refresh', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Registra un usuario nuevo y devuelve su primer refresh token y su id. */
  async function openSession(): Promise<{ refreshToken: string; userId: string }> {
    const response = await authPost(harness.app, 'register', {
      body: {
        email: `ana-${randomUUID()}@example.com`,
        password: PASSWORD,
        displayName: 'Ana',
      },
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    });
    expect(response.statusCode).toBe(201);
    const refreshToken = refreshTokenFrom(response.headers);
    if (refreshToken === undefined) {
      throw new Error('register did not set lv_refresh');
    }
    return {
      refreshToken,
      userId: sessionResponseSchema.parse(response.json()).user.id,
    };
  }

  function refresh(refreshToken?: string, csrf = true) {
    return authPost(harness.app, 'refresh', { refreshToken, csrf });
  }

  /** Rota y devuelve el sucesor. */
  async function rotate(refreshToken: string): Promise<string> {
    const response = await refresh(refreshToken);
    expect(response.statusCode).toBe(200);
    const successor = refreshTokenFrom(response.headers);
    if (successor === undefined) {
      throw new Error('refresh did not set lv_refresh');
    }
    return successor;
  }

  function expectClearedCookie(
    headers: Parameters<typeof refreshSetCookie>[0],
  ): void {
    const cookie = refreshSetCookie(headers) ?? '';
    expect(cookie).toMatch(/^lv_refresh=;/);
    expect(cookie.toLowerCase()).toContain('max-age=0');
    expect(cookie.toLowerCase()).toContain('path=/api/auth');
  }

  it('Rotación correcta', async () => {
    const { refreshToken: r1, userId } = await openSession();

    const response = await refresh(r1);

    expect(response.statusCode).toBe(200);
    const body = sessionResponseSchema.parse(response.json());
    expect(body.user.id).toBe(userId);
    expect(body.accessToken).not.toBe('');
    const r2 = refreshTokenFrom(response.headers);
    expect(r2).toBeDefined();
    expect(r2).not.toBe(r1);
  });

  it('Refresh sin cookie', async () => {
    const response = await refresh();

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'invalid_refresh',
      message: expect.any(String),
    });
    expectClearedCookie(response.headers);
  });

  it('answers an unknown refresh token with 401 invalid_refresh and clears the cookie', async () => {
    const response = await refresh('not-a-real-refresh-token');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'invalid_refresh' });
    expectClearedCookie(response.headers);
  });

  it('Reuso revoca la sesión', async () => {
    const { refreshToken: r1, userId } = await openSession();
    const r2 = await rotate(r1);
    harness.clock.advance(11_000);
    const warned = vi.spyOn(Logger.prototype, 'warn');

    const reused = await refresh(r1);
    const afterReuse = await refresh(r2);

    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({ code: 'invalid_refresh' });
    expectClearedCookie(reused.headers);
    expect(afterReuse.statusCode).toBe(401);
    const logs = JSON.stringify(warned.mock.calls);
    expect(logs).toContain(userId);
    expect(logs).not.toContain(r1);
    expect(logs).not.toContain(r2);
  });

  it('Refresh concurrente', async () => {
    const { refreshToken: r1 } = await openSession();
    const r2 = await rotate(r1);
    harness.clock.advance(2_000);

    const conflict = await refresh(r1);

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'refresh_conflict' });
    expect(conflict.headers['set-cookie']).toBeUndefined();
    expect((await refresh(r2)).statusCode).toBe(200);
  });

  it('Tres refresh concurrentes con el mismo token', async () => {
    const { refreshToken: r1 } = await openSession();

    const responses = await Promise.all([refresh(r1), refresh(r1), refresh(r1)]);

    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([200, 409, 409]);
    for (const response of responses.filter((r) => r.statusCode === 409)) {
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    const winner = responses.find((response) => response.statusCode === 200);
    const r2 = refreshTokenFrom(winner?.headers ?? {});
    expect(r2).toBeDefined();
    // La sesión sigue viva: el sucesor rota.
    expect((await refresh(r2)).statusCode).toBe(200);
  });

  it('Refresh token no guardado en claro', async () => {
    const { refreshToken: r1 } = await openSession();
    const r2 = await rotate(r1);

    const collections = await harness.connection.db?.collections();
    const dump: unknown[] = [];
    for (const collection of collections ?? []) {
      dump.push(await collection.find().toArray());
    }
    const serialized = JSON.stringify(dump);

    expect(serialized).not.toContain(r1);
    expect(serialized).not.toContain(r2);
  });

  it('Refresh sin cabecera', async () => {
    const { refreshToken: r1 } = await openSession();

    const response = await refresh(r1, false);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_header_missing' });
    expect(response.headers['set-cookie']).toBeUndefined();
    // R1 no se rotó: sigue sirviendo.
    expect((await refresh(r1)).statusCode).toBe(200);
  });
});
