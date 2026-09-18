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
  refreshTokenFrom,
  type AuthTestApp,
} from '../../../test-support/auth-test-app';
import { USERS_COLLECTION } from '../../users/infrastructure/user.schema';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../application/ports/password-hasher.port';

// `POST /api/auth/password` y límites de intentos por HTTP (tarea 6.7 de auth-users, D7) sobre la app completa, Mongo del
// preset y el doble de Redis.

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'new-correct-horse-battery';
const WRONG_PASSWORD = 'wrong-password-123';

let ipCounter = 0;
/** IP propia por test: el límite por IP no se mezcla entre tests. */
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

interface Session {
  readonly email: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

describe('AuthController password and HTTP attempt limits', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;
  let hasher: PasswordHasher;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
    });
    hasher = harness.app.get<PasswordHasher>(PASSWORD_HASHER, {
      strict: false,
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sessionFrom(
    email: string,
    response: Awaited<ReturnType<typeof authPost>>,
  ): Session {
    const refreshToken = refreshTokenFrom(response.headers);
    if (refreshToken === undefined) {
      throw new Error(`expected a session, got ${response.statusCode}`);
    }
    return {
      email,
      accessToken: sessionResponseSchema.parse(response.json()).accessToken,
      refreshToken,
    };
  }

  async function registerUser(): Promise<Session> {
    const email = `ana-${randomUUID()}@example.com`;
    const response = await authPost(harness.app, 'register', {
      body: { email, password: PASSWORD, displayName: 'Ana' },
      remoteAddress: nextIp(),
    });
    return sessionFrom(email, response);
  }

  function login(email: string, password: string, remoteAddress: string) {
    return authPost(harness.app, 'login', {
      body: { email, password },
      remoteAddress,
    });
  }

  function changePassword(
    session: Session,
    currentPassword: string,
    newPassword = NEW_PASSWORD,
  ) {
    return authPost(harness.app, 'password', {
      body: { currentPassword, newPassword },
      accessToken: session.accessToken,
    });
  }

  async function storedHash(email: string): Promise<unknown> {
    const user = await harness.connection
      .collection(USERS_COLLECTION)
      .findOne({ email });
    return user?.['passwordHash'];
  }

  /** Espías de las verificaciones de Argon2id (real y ficticia). */
  function spyVerifications(): () => number {
    const verify = vi.spyOn(hasher, 'verify');
    const verifyDummy = vi.spyOn(hasher, 'verifyDummy');
    return () => verify.mock.calls.length + verifyDummy.mock.calls.length;
  }

  it('Cambio correcto revoca las otras sesiones', async () => {
    const sessionA = await registerUser();
    const sessionB = sessionFrom(
      sessionA.email,
      await login(sessionA.email, PASSWORD, nextIp()),
    );

    const response = await changePassword(sessionA, PASSWORD);

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(
      (
        await authPost(harness.app, 'refresh', {
          refreshToken: sessionB.refreshToken,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await authPost(harness.app, 'refresh', {
          refreshToken: sessionA.refreshToken,
        })
      ).statusCode,
    ).toBe(200);
    const ip = nextIp();
    expect((await login(sessionA.email, PASSWORD, ip)).statusCode).toBe(401);
    expect((await login(sessionA.email, NEW_PASSWORD, ip)).statusCode).toBe(
      200,
    );
  });

  it('Contraseña actual incorrecta', async () => {
    const session = await registerUser();
    const before = await storedHash(session.email);

    const response = await changePassword(session, WRONG_PASSWORD);

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'invalid_credentials',
      message: expect.any(String),
    });
    expect(await storedHash(session.email)).toBe(before);
  });

  it('Fuerza bruta de la contraseña actual', async () => {
    const session = await registerUser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await changePassword(session, WRONG_PASSWORD)).statusCode).toBe(
        401,
      );
    }
    const verifications = spyVerifications();

    const response = await changePassword(session, PASSWORD);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'too_many_attempts' });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(verifications()).toBe(0);
  });

  it('requires an access token and applies the policy to newPassword', async () => {
    const session = await registerUser();

    const anonymous = await authPost(harness.app, 'password', {
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    const shortPassword = await changePassword(session, PASSWORD, 'short');
    const matchesEmail = await changePassword(session, PASSWORD, session.email);

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: 'unauthorized' });
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json()).toMatchObject({ fields: ['newPassword'] });
    expect(matchesEmail.statusCode).toBe(400);
    expect(matchesEmail.json()).toMatchObject({ fields: ['newPassword'] });
  });

  it('Demasiados fallos por email', async () => {
    const { email } = await registerUser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(email, WRONG_PASSWORD, nextIp())).statusCode).toBe(
        401,
      );
    }

    const response = await login(email, PASSWORD, nextIp());

    expect(response.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'too_many_attempts',
    );
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('Email inexistente también se limita', async () => {
    const email = `nadie-${randomUUID()}@example.com`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(email, WRONG_PASSWORD, nextIp())).statusCode).toBe(
        401,
      );
    }

    expect((await login(email, WRONG_PASSWORD, nextIp())).statusCode).toBe(429);
  });

  it('Fallos concurrentes', async () => {
    const { email } = await registerUser();
    const ip = nextIp();
    const verifications = spyVerifications();

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => login(email, WRONG_PASSWORD, ip)),
    );

    const statuses = responses.map((response) => response.statusCode);
    expect(verifications()).toBeGreaterThan(0);
    expect(verifications()).toBeLessThanOrEqual(5);
    expect(statuses.filter((status) => status === 401).length).toBe(
      verifications(),
    );
    expect(statuses.filter((status) => status === 429).length).toBe(
      20 - verifications(),
    );
  });

  it('Login correcto reinicia el contador', async () => {
    const { email } = await registerUser();
    const ip = nextIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await login(email, WRONG_PASSWORD, ip)).statusCode);
    }
    statuses.push((await login(email, PASSWORD, ip)).statusCode);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await login(email, WRONG_PASSWORD, ip)).statusCode);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 200, 401, 401, 401, 401]);
  });

  // 51 logins correctos con Argon2id real y una sesión nueva por login: el margen es para un runner de CI cargado, no
  // porque se espere que tarde tanto.
  it(
    'Logins correctos no agotan el límite por IP',
    { timeout: 30_000 },
    async () => {
      const { email } = await registerUser();
      const ip = nextIp();
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 51; attempt += 1) {
        statuses.push((await login(email, PASSWORD, ip)).statusCode);
      }

      expect(statuses).not.toContain(429);
      expect(statuses.every((status) => status === 200)).toBe(true);
    },
  );

  // Último: detiene el doble de Redis de este archivo.
  it('Almacén de contadores caído', async () => {
    const { email } = await registerUser();
    await redis.setMode('stop');
    const warned = vi.spyOn(Logger.prototype, 'warn');

    const first = await login(email, PASSWORD, nextIp());
    const second = await login(email, PASSWORD, nextIp());

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // Solo cuentan los avisos del contador de intentos: el cliente Redis de salud también avisa, según el momento, de
    // que perdió la conexión, y ese aviso no es parte del escenario.
    const limiterWarnings = warned.mock.calls.filter(([message]) =>
      String(message).startsWith('Attempt counter store unavailable'),
    );
    expect(limiterWarnings).toHaveLength(1);
    expect(JSON.stringify(warned.mock.calls)).not.toContain(email);
  });
});
