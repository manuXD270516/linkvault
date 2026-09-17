import { RedisPingDouble } from '@linkvault/testing';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRedisAppClient } from '../../../infrastructure/redis/redis-app-client';
import type { AttemptKey } from '../application/ports/attempt-limiter.port';
import {
  attemptKeyName,
  RedisAttemptLimiter,
  type AttemptLimiterLogger,
} from './redis-attempt-limiter';

// Fail-open del límite de intentos y agrupación IPv6 (tarea 4.9 de auth-users, D7) contra el doble RESP.

const SECRET = 'test-only-jwt-secret-at-least-32-chars';
const EMAIL = 'ana@example.com';
const emailKey: AttemptKey = { kind: 'login-email', email: EMAIL };

class RecordingLogger implements AttemptLimiterLogger {
  readonly warnings: string[] = [];
  readonly infos: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  log(message: string): void {
    this.infos.push(message);
  }
}

let double: RedisPingDouble;
let client: Redis;
let logger: RecordingLogger;
let limiter: RedisAttemptLimiter;

function whenReady(redis: Redis): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => redis.once('ready', () => resolve()));
}

beforeEach(async () => {
  double = await RedisPingDouble.start('up');
  client = createRedisAppClient(double.url);
  client.on('error', () => undefined);
  await client.connect();
  logger = new RecordingLogger();
  limiter = new RedisAttemptLimiter(client, { secret: SECRET }, logger);
});

afterEach(async () => {
  client.disconnect();
  await double.close();
});

function allLogs(): string {
  return [...logger.warnings, ...logger.infos].join('\n');
}

describe('RedisAttemptLimiter fail-open', () => {
  it('Almacén de contadores caído', async () => {
    await double.setMode('stop');

    const first = await limiter.consume(emailKey, 5);
    const second = await limiter.consume(emailKey, 5);

    expect(first).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(second).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logger.warnings).toHaveLength(1);
    expect(allLogs()).not.toContain(EMAIL);
    expect(allLogs()).not.toContain(attemptKeyName(emailKey, SECRET));
  });

  it('allows the request when Redis takes longer than 200 ms', async () => {
    await double.setMode('hang');

    const startedAt = Date.now();
    const decision = await limiter.consume(emailKey, 5);

    expect(decision).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(logger.warnings).toHaveLength(1);
  });

  it('never throws from reset or recordLoginSuccess while Redis is down', async () => {
    await double.setMode('stop');

    await expect(limiter.reset(emailKey)).resolves.toBeUndefined();
    await expect(
      limiter.recordLoginSuccess(EMAIL, '203.0.113.7'),
    ).resolves.toBeUndefined();
    expect(logger.warnings).toHaveLength(1);
    expect(allLogs()).not.toContain(EMAIL);
  });

  it('logs one info on recovery and a new warning on the next streak', async () => {
    await double.setMode('stop');
    await limiter.consume(emailKey, 5);
    await limiter.consume(emailKey, 5);

    await double.setMode('up');
    await whenReady(client);
    expect((await limiter.consume(emailKey, 5)).allowed).toBe(true);
    await limiter.consume(emailKey, 5);

    expect(logger.warnings).toHaveLength(1);
    expect(logger.infos).toHaveLength(1);

    await double.setMode('stop');
    await limiter.consume(emailKey, 5);

    expect(logger.warnings).toHaveLength(2);
    expect(logger.infos).toHaveLength(1);
  });

  it('does not log anything while Redis works', async () => {
    await limiter.consume(emailKey, 5);
    await limiter.recordLoginSuccess(EMAIL, '203.0.113.7');
    await limiter.reset(emailKey);

    expect(logger.warnings).toEqual([]);
    expect(logger.infos).toEqual([]);
  });
});

describe('RedisAttemptLimiter IPv6 grouping', () => {
  it('names IP keys by /64 and IPv4-mapped addresses as IPv4', () => {
    expect(
      attemptKeyName(
        { kind: 'login-ip', ip: '2001:db8:abcd:12:1:2:3:4' },
        SECRET,
      ),
    ).toBe('auth:login:ip:2001:db8:abcd:12::/64');
    expect(
      attemptKeyName({ kind: 'register-ip', ip: '::ffff:203.0.113.7' }, SECRET),
    ).toBe('auth:register:ip:203.0.113.7');
  });

  it('counts two addresses of the same /64 against one limit', async () => {
    expect(
      (await limiter.consume({ kind: 'register-ip', ip: '2001:db8:1:2::a' }, 1))
        .allowed,
    ).toBe(true);
    expect(
      (await limiter.consume({ kind: 'register-ip', ip: '2001:db8:1:2::b' }, 1))
        .allowed,
    ).toBe(false);
    expect(
      (await limiter.consume({ kind: 'register-ip', ip: '2001:db8:1:3::a' }, 1))
        .allowed,
    ).toBe(true);
  });

  it('gives back the IP attempt of a successful login from another address of the same /64', async () => {
    await limiter.consume({ kind: 'login-ip', ip: '2001:db8:1:2::a' }, 1);

    await limiter.recordLoginSuccess(EMAIL, '2001:db8:1:2::b');

    expect(
      (await limiter.consume({ kind: 'login-ip', ip: '2001:db8:1:2::c' }, 1))
        .allowed,
    ).toBe(true);
  });
});
