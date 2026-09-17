import { describe, expect, it } from 'vitest';
import type { Clock } from '../../domain/clock';
import { InMemoryAttemptLimiter } from './in-memory-attempt-limiter';

class MovableClock implements Clock {
  current = new Date('2026-09-17T10:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const email = { kind: 'login-email', email: 'ana@example.com' } as const;
const ip = { kind: 'login-ip', ip: '203.0.113.7' } as const;

describe('InMemoryAttemptLimiter', () => {
  it('allows up to the limit and gives Retry-After until the window ends', async () => {
    const clock = new MovableClock();
    const limiter = new InMemoryAttemptLimiter(clock);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.consume(email, 5)).allowed).toBe(true);
    }
    clock.advance(60_000);

    expect(await limiter.consume(email, 5)).toEqual({
      allowed: false,
      retryAfterSeconds: 840,
    });
    clock.advance(840_000);
    expect((await limiter.consume(email, 5)).allowed).toBe(true);
  });

  it('records every consumed key in order', async () => {
    const limiter = new InMemoryAttemptLimiter(new MovableClock());

    await limiter.consume(email, 5);
    await limiter.consume(ip, 50);

    expect(limiter.consumed).toEqual([email, ip]);
  });

  it('resets the email and gives back the IP attempt on a successful login', async () => {
    const limiter = new InMemoryAttemptLimiter(new MovableClock());
    await limiter.consume(email, 5);
    await limiter.consume(email, 5);
    await limiter.consume(ip, 50);
    await limiter.consume(ip, 50);

    await limiter.recordLoginSuccess('ana@example.com', '203.0.113.7');

    expect(limiter.count(email)).toBe(0);
    expect(limiter.count(ip)).toBe(1);
  });

  it('groups IPv6 addresses by /64 like the Redis adapter', async () => {
    const limiter = new InMemoryAttemptLimiter(new MovableClock());

    await limiter.consume({ kind: 'register-ip', ip: '2001:db8:1:2::a' }, 1);

    expect(
      (await limiter.consume({ kind: 'register-ip', ip: '2001:db8:1:2::b' }, 1))
        .allowed,
    ).toBe(false);
  });

  it('reset clears a counter', async () => {
    const limiter = new InMemoryAttemptLimiter(new MovableClock());
    await limiter.consume(email, 1);

    await limiter.reset(email);

    expect((await limiter.consume(email, 1)).allowed).toBe(true);
  });
});
