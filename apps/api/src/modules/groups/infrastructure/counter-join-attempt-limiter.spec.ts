import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import { CounterJoinAttemptLimiter } from './counter-join-attempt-limiter';

// `CounterJoinAttemptLimiter` (tarea 4.3, ADR-025 §6 a §8) sobre un contador guionizado: cada clave responde lo que el
// test decide (dejar pasar, rechazar o `null`), y cada llamada queda registrada en orden.

const ANA = '66e9a0000000000000000001';
const USER_KEY = `groups:join:user:${ANA}`;
const IPV4 = '203.0.113.7';
const IPV6 = '2001:db8:1:2:aaaa:bbbb:cccc:dddd';
const IP_KEY = `groups:join:ip:${IPV4}`;

const ALLOWED: AttemptOutcome = { allowed: true, retryAfterSeconds: 0 };

function rejected(retryAfterSeconds: number): AttemptOutcome {
  return { allowed: false, retryAfterSeconds };
}

type Call =
  | {
      readonly op: 'consume';
      readonly key: string;
      readonly limit: WindowLimit;
    }
  | { readonly op: 'giveBack'; readonly key: string };

class ScriptedCounter implements FixedWindowCounter {
  readonly calls: Call[] = [];
  private readonly outcomes = new Map<string, AttemptOutcome | null>();
  /** Si se fija, `giveBack` espera a esta promesa antes de resolver. */
  giveBackGate: Promise<void> | undefined;

  answer(key: string, outcome: AttemptOutcome | null): this {
    this.outcomes.set(key, outcome);
    return this;
  }

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    this.calls.push({ op: 'consume', key, limit });
    const outcome = this.outcomes.has(key) ? this.outcomes.get(key) : ALLOWED;
    return Promise.resolve(outcome ?? null);
  }

  reset(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async giveBack(key: string): Promise<boolean> {
    this.calls.push({ op: 'giveBack', key });
    await this.giveBackGate;
    return true;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CounterJoinAttemptLimiter.consume', () => {
  it('counts the user first and then the IP, with 10 and 100 every 15 minutes', async () => {
    const counter = new ScriptedCounter();
    const limiter = new CounterJoinAttemptLimiter(counter);

    const attempt = await limiter.consume(ANA, IPV4);

    expect(attempt).toEqual({
      userId: ANA,
      ip: IPV4,
      counted: ['user', 'ip'],
      rejected: false,
      retryAfterSeconds: 0,
    });
    expect(counter.calls).toEqual([
      {
        op: 'consume',
        key: USER_KEY,
        limit: { limit: 10, windowMs: 900_000 },
      },
      {
        op: 'consume',
        key: IP_KEY,
        limit: { limit: 100, windowMs: 900_000 },
      },
    ]);
  });

  it('groups an IPv6 by its /64 in the key', async () => {
    const counter = new ScriptedCounter();

    await new CounterJoinAttemptLimiter(counter).consume(ANA, IPV6);

    expect(counter.calls[1]).toMatchObject({
      key: 'groups:join:ip:2001:db8:1:2::/64',
    });
  });

  it('rejects with the Retry-After of the user and leaves the IP untouched', async () => {
    const counter = new ScriptedCounter().answer(USER_KEY, rejected(420));

    const attempt = await new CounterJoinAttemptLimiter(counter).consume(
      ANA,
      IPV4,
    );

    expect(attempt).toMatchObject({
      counted: ['user'],
      rejected: true,
      retryAfterSeconds: 420,
    });
    expect(counter.calls.map((call) => call.key)).toEqual([USER_KEY]);
  });

  it('gives the attempt back to the user when the IP rejects, with the Retry-After of the IP', async () => {
    const counter = new ScriptedCounter().answer(IP_KEY, rejected(77));

    const attempt = await new CounterJoinAttemptLimiter(counter).consume(
      ANA,
      IPV4,
    );

    expect(attempt).toMatchObject({
      counted: ['ip'],
      rejected: true,
      retryAfterSeconds: 77,
    });
    expect(counter.calls.map((call) => [call.op, call.key])).toEqual([
      ['consume', USER_KEY],
      ['consume', IP_KEY],
      ['giveBack', USER_KEY],
    ]);
  });

  it('fails open and leaves out the counter that answered null', async () => {
    const counter = new ScriptedCounter().answer(USER_KEY, null);

    const attempt = await new CounterJoinAttemptLimiter(counter).consume(
      ANA,
      IPV4,
    );

    expect(attempt).toMatchObject({ counted: ['ip'], rejected: false });
  });

  it('does not give back to a user counter that answered null when the IP rejects', async () => {
    const counter = new ScriptedCounter()
      .answer(USER_KEY, null)
      .answer(IP_KEY, rejected(30));

    const attempt = await new CounterJoinAttemptLimiter(counter).consume(
      ANA,
      IPV4,
    );

    expect(attempt).toMatchObject({ counted: ['ip'], rejected: true });
    expect(counter.calls.some((call) => call.op === 'giveBack')).toBe(false);
  });

  it('lets everything through when the store does not answer at all', async () => {
    const counter = new ScriptedCounter()
      .answer(USER_KEY, null)
      .answer(IP_KEY, null);

    const attempt = await new CounterJoinAttemptLimiter(counter).consume(
      ANA,
      IPV4,
    );

    expect(attempt).toMatchObject({ counted: [], rejected: false });
  });
});

describe('CounterJoinAttemptLimiter.giveBack', () => {
  it('launches both give-backs before the first one resolves', async () => {
    const counter = new ScriptedCounter();
    const limiter = new CounterJoinAttemptLimiter(counter);
    const attempt = await limiter.consume(ANA, IPV4);
    let open: () => void = () => undefined;
    counter.giveBackGate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const pending = limiter.giveBack(attempt);
    await Promise.resolve();

    // Los dos `giveBack` ya se pidieron aunque ninguno ha resuelto: van en paralelo.
    expect(
      counter.calls
        .filter((call) => call.op === 'giveBack')
        .map((call) => call.key),
    ).toEqual([USER_KEY, IP_KEY]);
    open();
    await pending;
  });

  it('only gives back to the counters that counted', async () => {
    const counter = new ScriptedCounter().answer(IP_KEY, null);
    const limiter = new CounterJoinAttemptLimiter(counter);
    const attempt = await limiter.consume(ANA, IPV4);

    await limiter.giveBack(attempt);

    expect(
      counter.calls
        .filter((call) => call.op === 'giveBack')
        .map((call) => call.key),
    ).toEqual([USER_KEY]);
  });

  it('does nothing with a rejected attempt', async () => {
    const counter = new ScriptedCounter().answer(USER_KEY, rejected(10));
    const limiter = new CounterJoinAttemptLimiter(counter);
    const attempt = await limiter.consume(ANA, IPV4);

    await limiter.giveBack(attempt);

    expect(counter.calls.some((call) => call.op === 'giveBack')).toBe(false);
  });
});

describe('logging', () => {
  it('logs nothing, not even when the store fails: the warning belongs to the counter', async () => {
    const logged = [
      vi.spyOn(Logger.prototype, 'error'),
      vi.spyOn(Logger.prototype, 'warn'),
      vi.spyOn(Logger.prototype, 'log'),
      vi.spyOn(Logger, 'error'),
      vi.spyOn(Logger, 'warn'),
      vi.spyOn(Logger, 'log'),
    ];
    const counter = new ScriptedCounter()
      .answer(USER_KEY, null)
      .answer(IP_KEY, rejected(5));
    const limiter = new CounterJoinAttemptLimiter(counter);

    const attempt = await limiter.consume(ANA, IPV4);
    await limiter.giveBack(attempt);
    await limiter.giveBack(await limiter.consume(ANA, '198.51.100.1'));

    for (const spy of logged) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
