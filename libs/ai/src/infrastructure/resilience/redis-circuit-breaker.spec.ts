import { describe, expect, it } from 'vitest';
import type { Clock } from '../../domain/ports/clock.port';
import type {
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';
import { buildChain } from '../../domain/routing-policy';
import {
  AI_CIRCUIT_IDS_KEY,
  circuitProbeKey,
  circuitStateKey,
  RedisCircuitBreaker,
  type CircuitBreakerRedisClient,
} from './redis-circuit-breaker';

// Tarea 4.2: misma semántica que InMemoryCircuitBreaker sobre un Redis doble, y estado compartido entre instancias.

class FakeClock implements Clock {
  private current = 1_700_000_000_000;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

/** Redis mínimo con `SET NX PX`, conjuntos y claves, gobernado por el reloj del test. */
class FakeRedis implements CircuitBreakerRedisClient {
  private readonly strings = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();
  private readonly sets = new Map<string, Set<string>>();

  constructor(private readonly clock: FakeClock) {}

  async get(key: string): Promise<string | null> {
    return this.liveString(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    mode?: 'PX',
    ms?: number,
    condition?: 'NX',
  ): Promise<'OK' | null> {
    if (condition === 'NX' && this.liveString(key) !== null) {
      return null;
    }
    this.strings.set(key, {
      value,
      expiresAt:
        mode === 'PX' && ms !== undefined ? this.clock.now() + ms : null,
    });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) removed += 1;
      if (this.sets.delete(key)) removed += 1;
    }
    return removed;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.sets.get(key);
    if (set === undefined) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (set === undefined) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed += 1;
    }
    if (set.size === 0) this.sets.delete(key);
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    this.throwIfFailing();
    return [...(this.sets.get(key) ?? [])];
  }

  async exists(...keys: string[]): Promise<number> {
    this.throwIfFailing();
    let count = 0;
    for (const key of keys) {
      if (this.liveString(key) !== null || this.sets.has(key)) count += 1;
    }
    return count;
  }

  /** Fuerza la siguiente operación a fallar una vez (instantánea inaccesible). */
  failNext = false;

  private throwIfFailing(): void {
    if (!this.failNext) return;
    this.failNext = false;
    throw new Error('redis unavailable');
  }

  private liveString(
    key: string,
  ): { value: string; expiresAt: number | null } | null {
    this.throwIfFailing();
    const entry = this.strings.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.clock.now()) {
      this.strings.delete(key);
      return null;
    }
    return entry;
  }
}

const capabilities: ProviderCapabilities = {
  jsonMode: true,
  toolUse: false,
  maxContextTokens: 8192,
  external: false,
  costPer1kIn: 0,
  costPer1kOut: 0,
};

function provider(id: string): LlmProvider {
  return {
    id,
    capabilities,
    complete: () => Promise.reject(new Error('not used')),
    healthy: () => Promise.resolve(true),
  };
}

async function chainIds(
  breaker: RedisCircuitBreaker,
  providers: readonly LlmProvider[],
): Promise<string[]> {
  return buildChain({
    task: { requires: {} },
    ctx: { aiConsent: { externalProviders: true } },
    providers,
    openIds: await breaker.openIds(),
  }).providers.map((p) => p.id);
}

async function failTimes(
  breaker: RedisCircuitBreaker,
  id: string,
  times: number,
  clock?: FakeClock,
  stepMs = 0,
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await breaker.recordFailure(id);
    if (clock) clock.advance(stepMs);
  }
}

describe('RedisCircuitBreaker', () => {
  const ollama = provider('ollama');
  const openrouter = provider('openrouter');

  it('Apertura tras fallos repetidos', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const breaker = new RedisCircuitBreaker(redis, clock);

    await failTimes(breaker, 'ollama', 4, clock, 10_000);
    expect(await chainIds(breaker, [ollama, openrouter])).toEqual([
      'ollama',
      'openrouter',
    ]);

    await breaker.recordFailure('ollama');

    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
    expect(await chainIds(breaker, [ollama, openrouter])).toEqual([
      'openrouter',
    ]);
    expect(await breaker.tryAcquire('ollama')).toBe(false);
    expect(await breaker.tryAcquire('openrouter')).toBe(true);
  });

  it('does not open when the 5 failures are spread over more than 60 seconds', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);

    await failTimes(breaker, 'ollama', 5, clock, 15_000);

    expect((await breaker.openIds()).size).toBe(0);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
  });

  it('stays open for 30 seconds and then admits a probe', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    await failTimes(breaker, 'ollama', 5);

    clock.advance(29_999);
    expect((await breaker.openIds()).has('ollama')).toBe(true);
    expect(await breaker.tryAcquire('ollama')).toBe(false);

    clock.advance(1);
    expect((await breaker.openIds()).has('ollama')).toBe(false);
    expect(await chainIds(breaker, [ollama])).toEqual(['ollama']);
  });

  it('Recuperación en half-open', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_001);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    await breaker.recordSuccess('ollama');

    expect((await breaker.openIds()).size).toBe(0);
    expect(await chainIds(breaker, [ollama, openrouter])).toContain('ollama');
    expect(await breaker.tryAcquire('ollama')).toBe(true);

    await failTimes(breaker, 'ollama', 4);
    expect((await breaker.openIds()).size).toBe(0);
  });

  it('grants a single probe permit while a probe is in flight', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_000);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    expect(await breaker.tryAcquire('ollama')).toBe(false);
    expect((await breaker.openIds()).has('ollama')).toBe(true);
  });

  it('reopens when the half-open probe fails', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_000);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    await breaker.recordFailure('ollama');

    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
    expect(await chainIds(breaker, [ollama, openrouter])).toEqual([
      'openrouter',
    ]);

    clock.advance(29_999);
    expect(await breaker.tryAcquire('ollama')).toBe(false);
    clock.advance(1);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
  });

  it('release returns a granted half-open permit so a new tryAcquire gets it again', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_000);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    expect(await breaker.tryAcquire('ollama')).toBe(false);

    await breaker.release('ollama');

    expect((await breaker.openIds()).has('ollama')).toBe(false);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    await breaker.recordFailure('ollama');
    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
  });

  it('two distinct breaker instances on the same Redis see the same open circuit', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const writer = new RedisCircuitBreaker(redis, clock);
    const reader = new RedisCircuitBreaker(redis, clock);

    await failTimes(writer, 'ollama', 5);

    expect(await reader.openIds()).toEqual(new Set(['ollama']));
    expect(await reader.tryAcquire('ollama')).toBe(false);
    expect(await redis.get(circuitStateKey('ollama'))).not.toBeNull();
    expect(await redis.smembers(AI_CIRCUIT_IDS_KEY)).toContain('ollama');
    expect(await redis.exists(circuitProbeKey('ollama'))).toBe(0);
  });

  it('snapshotOpenIds returns null when Redis is unreachable', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const breaker = new RedisCircuitBreaker(redis, clock);
    await failTimes(breaker, 'ollama', 5);

    redis.failNext = true;
    expect(await breaker.snapshotOpenIds()).toBeNull();
    // openIds falla abierto: conjunto vacío para no bloquear runTask.
    redis.failNext = true;
    expect(await breaker.openIds()).toEqual(new Set());
  });
});
