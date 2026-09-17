import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  sessionResponseSchema,
} from '@linkvault/shared';
import { getMongoTestUri, RedisPingDouble } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authPost,
  createAuthTestApp,
  refreshSetCookie,
  refreshTokenFrom,
  type AuthTestApp,
} from '../../../test-support/auth-test-app';
import { USERS_COLLECTION } from '../../users/infrastructure/user.schema';

// `AuthController` register y login (tarea 6.4 de auth-users) sobre la app completa, Mongo del preset y el doble de Redis.

const PASSWORD = 'correct-horse-battery';

function uniqueEmail(): string {
  return `ana-${randomUUID()}@example.com`;
}

function cookieAttributes(cookie: string): string[] {
  return cookie
    .split(';')
    .slice(1)
    .map((part) => part.trim().toLowerCase());
}

describe('AuthController register and login', () => {
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

  function register(body: unknown, remoteAddress = '198.51.100.1') {
    return authPost(harness.app, 'register', { body, remoteAddress });
  }

  function usersCollection() {
    return harness.connection.collection(USERS_COLLECTION);
  }

  it('Registro correcto', async () => {
    const response = await register({
      email: '  Ana@Example.com ',
      password: PASSWORD,
      displayName: 'Ana',
    });

    expect(response.statusCode).toBe(201);
    const body = sessionResponseSchema.parse(response.json());
    expect(body.accessToken).not.toBe('');
    expect(body.user.email).toBe('ana@example.com');
    expect(refreshTokenFrom(response.headers)).toBeDefined();
    const stored = await usersCollection().findOne({
      email: 'ana@example.com',
    });
    expect(stored).not.toBeNull();
  });

  it('Registro inválido', async () => {
    const response = await register({
      email: 'ana-at-example.com',
      password: PASSWORD,
      displayName: '',
    });

    expect(response.statusCode).toBe(400);
    const body = apiErrorResponseSchema.parse(response.json());
    expect(body.code).toBe('validation_error');
    expect(body.fields).toEqual(
      expect.arrayContaining(['email', 'displayName']),
    );
    expect(response.body).not.toContain('ana-at-example.com');
    expect(refreshSetCookie(response.headers)).toBeUndefined();
  });

  it('Email ya registrado', async () => {
    const local = `dup-${randomUUID()}`;
    const first = await register({
      email: `${local}@example.com`,
      password: PASSWORD,
      displayName: 'Ana',
    });
    expect(first.statusCode).toBe(201);

    const response = await register({
      email: `${local.toUpperCase()}@example.com`,
      password: PASSWORD,
      displayName: 'Otra',
    });

    expect(response.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'email_taken',
      message: expect.any(String),
    });
    expect(refreshSetCookie(response.headers)).toBeUndefined();
    expect(
      await usersCollection().countDocuments({ email: `${local}@example.com` }),
    ).toBe(1);
  });

  it('Contraseña corta', async () => {
    const email = uniqueEmail();
    const password = 'short-pw9';
    expect(password).toHaveLength(9);

    const response = await register({ email, password, displayName: 'Ana' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_error',
      fields: ['password'],
    });
    expect(response.body).not.toContain(password);
    expect(await usersCollection().countDocuments({ email })).toBe(0);
  });

  it('Contraseña igual al email', async () => {
    const email = uniqueEmail();

    const response = await register({
      email,
      password: email,
      displayName: 'Ana',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_error',
      fields: ['password'],
    });
  });

  it('Login correcto', async () => {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, displayName: 'Ana' });

    const response = await authPost(harness.app, 'login', {
      body: { email: email.replace('ana', 'ANA'), password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const body = sessionResponseSchema.parse(response.json());
    expect(body.user.email).toBe(email);
    expect(refreshTokenFrom(response.headers)).toBeDefined();
  });

  it('Hash Argon2id', async () => {
    const email = uniqueEmail();

    await register({ email, password: PASSWORD, displayName: 'Ana' });

    const stored = await usersCollection().findOne({ email });
    expect(stored?.['passwordHash']).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
  });

  it('Respuestas sin hash', async () => {
    const email = uniqueEmail();

    const registered = await register({
      email,
      password: PASSWORD,
      displayName: 'Ana',
    });
    const loggedIn = await authPost(harness.app, 'login', {
      body: { email, password: PASSWORD },
    });

    for (const response of [registered, loggedIn]) {
      expect(response.body).not.toContain(PASSWORD);
      expect(response.body).not.toContain('$argon2id$');
      expect(response.body).not.toContain('passwordHash');
    }
  });

  it('Credenciales inválidas indistinguibles', async () => {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, displayName: 'Ana' });

    const wrongPassword = await authPost(harness.app, 'login', {
      body: { email, password: 'wrong-password-123' },
      remoteAddress: '198.51.100.20',
    });
    const unknownEmail = await authPost(harness.app, 'login', {
      body: { email: uniqueEmail(), password: 'wrong-password-123' },
      remoteAddress: '198.51.100.20',
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ code: 'invalid_credentials' });
    expect(wrongPassword.body).toBe(unknownEmail.body);
    expect(refreshSetCookie(wrongPassword.headers)).toBeUndefined();
  });

  it('Login desde un formulario ajeno', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'x-requested-with': 'linkvault',
        'content-type': 'text/plain',
      },
      payload: JSON.stringify({ email: uniqueEmail(), password: PASSWORD }),
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_media_type' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('Límite de registros por IP', async () => {
    const ip = '198.51.100.99';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await register(
        { email: uniqueEmail(), password: PASSWORD, displayName: 'Ana' },
        ip,
      );
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(statuses[10]).toBe(429);
  });
});

describe('AuthController login in development', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
      config: { NODE_ENV: 'development' },
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  function register(body: unknown) {
    return authPost(harness.app, 'register', { body });
  }

  it('Login fija la cookie de refresh', async () => {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, displayName: 'Ana' });

    const response = await authPost(harness.app, 'login', {
      body: { email, password: PASSWORD },
    });

    const cookie = refreshSetCookie(response.headers);
    expect(cookie).toBeDefined();
    const attributes = cookieAttributes(cookie ?? '');
    expect(attributes).toContain('httponly');
    expect(attributes).toContain('samesite=lax');
    expect(attributes).toContain('path=/api/auth');
    expect(attributes).not.toContain('secure');
    const maxAge = attributes.find((attribute) =>
      attribute.startsWith('max-age='),
    );
    // 30 días (AUTH_REFRESH_TTL_DAYS), redondeado hacia abajo.
    expect(Number(maxAge?.slice('max-age='.length))).toBeGreaterThan(
      30 * 86_400 - 5,
    );
    expect(response.json()).toMatchObject({ expiresIn: 900 });
    expect(Object.keys(response.json() as object).sort()).toEqual([
      'accessToken',
      'expiresIn',
      'user',
    ]);
  });
});

describe('AuthController login in production', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
      config: { NODE_ENV: 'production' },
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  it('Cookie segura en producción', async () => {
    const email = uniqueEmail();
    await authPost(harness.app, 'register', {
      body: { email, password: PASSWORD, displayName: 'Ana' },
    });

    const response = await authPost(harness.app, 'login', {
      body: { email, password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(
      cookieAttributes(refreshSetCookie(response.headers) ?? ''),
    ).toContain('secure');
  });
});
