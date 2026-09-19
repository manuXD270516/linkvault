import { describe, expect, it } from 'vitest';
import { InMemoryJoinAttemptLimiter } from './in-memory-join-attempt-limiter';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const IP = '203.0.113.7';

describe('InMemoryJoinAttemptLimiter', () => {
  it('counts in both counters while the attempt is allowed', async () => {
    const limiter = new InMemoryJoinAttemptLimiter();

    const attempt = await limiter.consume(ANA, IP);

    expect(attempt).toEqual({
      userId: ANA,
      ip: IP,
      counted: ['user', 'ip'],
      rejected: false,
      retryAfterSeconds: 0,
    });
    expect(limiter.attemptsOfUser(ANA)).toBe(1);
    expect(limiter.attemptsOfIp(IP)).toBe(1);
  });

  it('rejects over the user limit without touching the IP', async () => {
    const limiter = new InMemoryJoinAttemptLimiter({
      userLimit: 2,
      retryAfterSeconds: 600,
    });
    await limiter.consume(ANA, IP);
    await limiter.consume(ANA, IP);

    const attempt = await limiter.consume(ANA, IP);

    expect(attempt).toMatchObject({
      counted: ['user'],
      rejected: true,
      retryAfterSeconds: 600,
    });
    expect(limiter.attemptsOfIp(IP)).toBe(2);
  });

  it('gives the attempt back to the user when the IP rejects', async () => {
    const limiter = new InMemoryJoinAttemptLimiter({ ipLimit: 1 });
    await limiter.consume(BETO, IP);

    const attempt = await limiter.consume(ANA, IP);

    expect(attempt).toMatchObject({ counted: ['ip'], rejected: true });
    expect(limiter.attemptsOfUser(ANA)).toBe(0);
    expect(limiter.attemptsOfIp(IP)).toBe(2);
  });

  it('gives an allowed attempt back to the counters that counted it, and records the call', async () => {
    const limiter = new InMemoryJoinAttemptLimiter();
    const attempt = await limiter.consume(ANA, IP);

    await limiter.giveBack(attempt);

    expect(limiter.attemptsOfUser(ANA)).toBe(0);
    expect(limiter.attemptsOfIp(IP)).toBe(0);
    expect(limiter.givenBack).toEqual([attempt]);
  });

  it('does not give back a rejected attempt', async () => {
    const limiter = new InMemoryJoinAttemptLimiter({ userLimit: 1 });
    await limiter.consume(ANA, IP);
    const rejected = await limiter.consume(ANA, IP);

    await limiter.giveBack(rejected);

    expect(limiter.attemptsOfUser(ANA)).toBe(2);
  });

  it('counts nothing and rejects nothing while the store is unavailable', async () => {
    const limiter = new InMemoryJoinAttemptLimiter({ userLimit: 0 });
    limiter.unavailable = true;

    const attempt = await limiter.consume(ANA, IP);
    await limiter.giveBack(attempt);

    expect(attempt).toMatchObject({ counted: [], rejected: false });
    expect(limiter.attemptsOfUser(ANA)).toBe(0);
    expect(limiter.attemptsOfIp(IP)).toBe(0);
  });
});
