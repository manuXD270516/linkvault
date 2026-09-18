import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RedisPingDouble } from '@linkvault/testing';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisFixedWindowCounter } from '../../../infrastructure/limits/redis-fixed-window-counter';
import { createRedisAppClient } from '../../../infrastructure/redis/redis-app-client';
import type { AttemptKey } from '../application/ports/attempt-limiter.port';
import {
  ATTEMPT_WINDOW_MS,
  LOGIN_ATTEMPTS_PER_EMAIL,
  LOGIN_ATTEMPTS_PER_IP,
} from '../domain/attempt-limits';
import { attemptKeyName, RedisAttemptLimiter } from './redis-attempt-limiter';

// RedisAttemptLimiter (tarea 4.8 de auth-users, D7) contra el doble RESP de @linkvault/testing con el cliente de
// aplicación real (lazyConnect, sin cola offline, commandTimeout 200 ms).

const SECRET = 'test-only-jwt-secret-at-least-32-chars';
const EMAIL = 'ana@example.com';
const IP = '203.0.113.7';
const emailKey: AttemptKey = { kind: 'login-email', email: EMAIL };
const ipKey: AttemptKey = { kind: 'login-ip', ip: IP };

let double: RedisPingDouble;
let client: Redis;
let inspector: Redis;

function whenReady(redis: Redis): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => redis.once('ready', () => resolve()));
}

beforeEach(async () => {
  double = await RedisPingDouble.start('up');
  client = createRedisAppClient(double.url);
  client.on('error', () => undefined);
  await client.connect();
  await whenReady(client);
  inspector = createRedisAppClient(double.url);
  inspector.on('error', () => undefined);
  await inspector.connect();
});

afterEach(async () => {
  client.disconnect();
  inspector.disconnect();
  await double.close();
});

function limiter(windowMs = ATTEMPT_WINDOW_MS): RedisAttemptLimiter {
  return new RedisAttemptLimiter(new RedisFixedWindowCounter(client), {
    secret: SECRET,
    windowMs,
  });
}

/** Espera a que Redis dé la clave por caducada (`PTTL` -2); no supone cuánto tarda el runner en llegar hasta aquí. */
async function waitUntilExpired(name: string): Promise<void> {
  // Se rinde antes del timeout del test para que el fallo diga que la clave no caducó, no que el test tardó demasiado.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await inspector.pttl(name)) === -2) {
      return;
    }
    await delay(10);
  }
  throw new Error('the counter never expired');
}

async function consumeTimes(
  target: RedisAttemptLimiter,
  key: AttemptKey,
  times: number,
  limit: number,
) {
  const decisions = [];
  for (let i = 0; i < times; i++) {
    decisions.push(await target.consume(key, limit));
  }
  return decisions;
}

describe('attemptKeyName', () => {
  it('protects the email with HMAC-SHA256 of the JWT secret', () => {
    const expected = createHmac('sha256', SECRET).update(EMAIL).digest('hex');

    expect(attemptKeyName(emailKey, SECRET)).toBe(
      `auth:login:email:${expected}`,
    );
    expect(attemptKeyName(emailKey, SECRET)).not.toContain('ana');
    expect(attemptKeyName(emailKey, `${SECRET}-other`)).not.toBe(
      attemptKeyName(emailKey, SECRET),
    );
  });

  it('names the login and register IP counters', () => {
    expect(attemptKeyName(ipKey, SECRET)).toBe(`auth:login:ip:${IP}`);
    expect(attemptKeyName({ kind: 'register-ip', ip: IP }, SECRET)).toBe(
      `auth:register:ip:${IP}`,
    );
  });
});

describe('RedisAttemptLimiter', () => {
  it('allows up to the limit and rejects the next attempt', async () => {
    const decisions = await consumeTimes(
      limiter(),
      emailKey,
      LOGIN_ATTEMPTS_PER_EMAIL + 1,
      LOGIN_ATTEMPTS_PER_EMAIL,
    );

    expect(decisions.slice(0, 5)).toEqual(
      Array.from({ length: 5 }, () => ({
        allowed: true,
        retryAfterSeconds: 0,
      })),
    );
    expect(decisions[5]?.allowed).toBe(false);
  });

  it('gives Retry-After as the whole seconds left in the window', async () => {
    const target = limiter();
    await consumeTimes(target, emailKey, 5, 5);

    const rejected = await target.consume(emailKey, 5);

    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(899);
  });

  it('stores the counter under the HMAC key with the 15-minute window', async () => {
    await limiter().consume(emailKey, 5);
    const name = attemptKeyName(emailKey, SECRET);

    expect(await inspector.get(name)).toBe('1');
    const pttl = await inspector.pttl(name);
    expect(pttl).toBeGreaterThan(ATTEMPT_WINDOW_MS - 5_000);
    expect(pttl).toBeLessThanOrEqual(ATTEMPT_WINDOW_MS);
  });

  it('keeps the window fixed: later attempts do not extend it', async () => {
    const target = limiter();
    await target.consume(emailKey, 5);
    const name = attemptKeyName(emailKey, SECRET);
    const first = await inspector.pttl(name);
    await delay(30);

    await target.consume(emailKey, 5);

    expect(await inspector.pttl(name)).toBeLessThan(first);
  });

  it('starts a new window once the previous one expires', async () => {
    const target = limiter();
    const name = attemptKeyName(emailKey, SECRET);
    await consumeTimes(target, emailKey, 5, 5);
    expect((await target.consume(emailKey, 5)).allowed).toBe(false);
    expect(await inspector.get(name)).toBe('6');

    // El final de la ventana se adelanta acortando la caducidad del contador, en lugar de acortar la ventana y confiar
    // en que los seis intentos entren en ella: así el resultado no depende de lo que tarde la máquina.
    await inspector.set(name, '6', 'PX', 20);
    await waitUntilExpired(name);

    expect(await target.consume(emailKey, 5)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    // La ventana nueva vuelve a durar lo que marca la política, no lo que quedaba de la anterior.
    const pttl = await inspector.pttl(name);
    expect(pttl).toBeGreaterThan(ATTEMPT_WINDOW_MS - 5_000);
    expect(pttl).toBeLessThanOrEqual(ATTEMPT_WINDOW_MS);
  });

  it('counts concurrent attempts atomically', async () => {
    const target = limiter();

    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => target.consume(emailKey, 5)),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });

  it('keeps separate counters per kind of key', async () => {
    const target = limiter();
    await consumeTimes(target, emailKey, 5, 5);

    expect((await target.consume(ipKey, 5)).allowed).toBe(true);
    expect(
      (await target.consume({ kind: 'register-ip', ip: IP }, 5)).allowed,
    ).toBe(true);
    expect(
      (
        await target.consume(
          { kind: 'login-email', email: 'otra@example.com' },
          5,
        )
      ).allowed,
    ).toBe(true);
  });

  it('reset puts a counter back to zero', async () => {
    const target = limiter();
    await consumeTimes(target, emailKey, 5, 5);

    await target.reset(emailKey);

    expect((await target.consume(emailKey, 5)).allowed).toBe(true);
    expect(await inspector.get(attemptKeyName(emailKey, SECRET))).toBe('1');
  });

  it('Login correcto reinicia el contador', async () => {
    const target = limiter();
    await consumeTimes(target, emailKey, 4, 5);
    await target.consume(emailKey, 5);
    await target.recordLoginSuccess(EMAIL, IP);

    const later = await consumeTimes(target, emailKey, 4, 5);

    expect(later.every((decision) => decision.allowed)).toBe(true);
  });

  // 51 logins correctos son más de 150 idas y vueltas a Redis; el margen es para un runner de CI cargado, no porque se
  // espere que tarde tanto.
  it(
    'Logins correctos no agotan el límite por IP',
    { timeout: 30_000 },
    async () => {
      const target = limiter();

      for (let i = 0; i < LOGIN_ATTEMPTS_PER_IP + 1; i++) {
        const decision = await target.consume(ipKey, LOGIN_ATTEMPTS_PER_IP);
        expect(decision.allowed).toBe(true);
        await target.recordLoginSuccess(EMAIL, IP);
      }

      // Un contador que vuelve a 0 se borra: la IP no conserva ventana por logins correctos.
      expect(await inspector.get(attemptKeyName(ipKey, SECRET))).toBeNull();
    },
  );

  it('keeps failed IP attempts after a success of another attempt', async () => {
    const target = limiter();
    await consumeTimes(target, ipKey, 3, 50);
    await target.consume(ipKey, 50);

    await target.recordLoginSuccess(EMAIL, IP);

    expect(await inspector.get(attemptKeyName(ipKey, SECRET))).toBe('3');
    expect(await inspector.pttl(attemptKeyName(ipKey, SECRET))).toBeGreaterThan(
      0,
    );
  });

  it('does not leave a counter without expiration when the IP window already ended', async () => {
    const target = limiter(100);
    await target.consume(ipKey, 50);
    await delay(150);

    await target.recordLoginSuccess(EMAIL, IP);

    expect(await inspector.get(attemptKeyName(ipKey, SECRET))).toBeNull();
    expect((await target.consume(ipKey, 1)).allowed).toBe(true);
  });
});
