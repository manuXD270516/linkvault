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

  /** Cada `set` recibido, para comprobar que solo la clave del permiso lleva caducidad. */
  readonly setCalls: { key: string; px: number | undefined }[] = [];

  async set(
    key: string,
    value: string,
    mode?: 'PX',
    ms?: number,
    condition?: 'NX',
  ): Promise<'OK' | null> {
    this.setCalls.push({ key, px: mode === 'PX' ? ms : undefined });
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

  it('five 429 open the circuit like any failure', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    const rateLimited = { kind: 'rate_limited' } as const;

    for (let i = 0; i < 4; i++)
      await breaker.recordFailure('ollama', rateLimited);
    expect((await breaker.openIds()).size).toBe(0);
    await breaker.recordFailure('ollama', rateLimited);

    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
    expect((await breaker.openConditions()).get('ollama')).toEqual(rateLimited);
    clock.advance(30_000);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
  });

  it('remembers the dominant kind of the window (shared between instances)', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);

    await breaker.recordFailure('ollama', { kind: 'unavailable' });
    for (let i = 0; i < 4; i++) {
      await breaker.recordFailure('ollama', { kind: 'rate_limited' });
    }

    expect((await breaker.openConditions()).get('ollama')).toEqual({
      kind: 'unavailable',
    });
  });

  it('a failure outside the window does not count for the kind', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);

    await breaker.recordFailure('ollama', { kind: 'unavailable' });
    clock.advance(61_000);
    for (let i = 0; i < 5; i++) {
      await breaker.recordFailure('ollama', { kind: 'rate_limited' });
    }

    expect((await breaker.openConditions()).get('ollama')).toEqual({
      kind: 'rate_limited',
    });
  });

  it('a failed half-open probe remembers the probe kind', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    for (let i = 0; i < 5; i++) {
      await breaker.recordFailure('ollama', { kind: 'unavailable' });
    }
    clock.advance(30_000);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    await breaker.recordFailure('ollama', { kind: 'rejected' });

    expect((await breaker.openConditions()).get('ollama')).toEqual({
      kind: 'rejected',
    });
  });

  it('recordSuccess on an open circuit forgets the remembered kind', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    for (let i = 0; i < 5; i++) {
      await breaker.recordFailure('ollama', { kind: 'rejected' });
    }
    clock.advance(30_000);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    await breaker.recordSuccess('ollama');

    expect((await breaker.openConditions()).size).toBe(0);
    // Cerrado con la ventana vacía: 4 errores de otra clase no abren, y al quinto la clase es la nueva.
    for (let i = 0; i < 4; i++) {
      await breaker.recordFailure('ollama', { kind: 'rate_limited' });
    }
    expect((await breaker.openIds()).size).toBe(0);
    await breaker.recordFailure('ollama', { kind: 'rate_limited' });
    expect((await breaker.openConditions()).get('ollama')).toEqual({
      kind: 'rate_limited',
    });
  });

  it('a success on a closed circuit keeps the failure window', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);

    for (let i = 0; i < 4; i++) await breaker.recordFailure('ollama');
    await breaker.recordSuccess('ollama');
    await breaker.recordFailure('ollama');

    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
  });

  it('a closed circuit has no condition', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);

    for (let i = 0; i < 4; i++) {
      await breaker.recordFailure('ollama', { kind: 'rate_limited' });
    }

    expect((await breaker.openConditions()).size).toBe(0);
  });

  it('openConditions returns the kind of each open circuit', async () => {
    const clock = new FakeClock();
    const breaker = new RedisCircuitBreaker(new FakeRedis(clock), clock);
    for (let i = 0; i < 5; i++) {
      await breaker.recordFailure('ollama', { kind: 'rate_limited' });
      await breaker.recordFailure('openrouter', { kind: 'rejected' });
    }
    for (let i = 0; i < 2; i++) await breaker.recordFailure('other');

    expect(await breaker.openConditions()).toEqual(
      new Map([
        ['ollama', { kind: 'rate_limited' }],
        ['openrouter', { kind: 'rejected' }],
      ]),
    );
    // Misma regla que snapshotOpenIds: con el permiso de prueba tomado sigue contando; sin tomarlo y vencido, no.
    clock.advance(30_000);
    expect((await breaker.openConditions()).size).toBe(0);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    expect((await breaker.openConditions()).get('ollama')).toEqual({
      kind: 'rate_limited',
    });
  });

  it('remembers the dominant kind across instances sharing the store', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const writer = new RedisCircuitBreaker(redis, clock);
    const reader = new RedisCircuitBreaker(redis, clock);

    await writer.recordFailure('ollama', { kind: 'unavailable' });
    for (let i = 0; i < 4; i++) {
      await new RedisCircuitBreaker(redis, clock).recordFailure('ollama', {
        kind: 'rate_limited',
      });
    }

    expect((await reader.openConditions()).get('ollama')).toEqual({
      kind: 'unavailable',
    });
  });

  it('a stored circuit without kinds reads as unavailable', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const breaker = new RedisCircuitBreaker(redis, clock);
    await redis.set(
      circuitStateKey('ollama'),
      JSON.stringify({ failures: [], openedAt: clock.now() }),
    );
    await redis.sadd(AI_CIRCUIT_IDS_KEY, 'ollama');

    expect((await breaker.openConditions()).get('ollama')).toEqual({
      kind: 'unavailable',
    });
  });

  it('kinds shorter than failures are padded as unavailable', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const breaker = new RedisCircuitBreaker(redis, clock);
    const t0 = clock.now();
    await redis.set(
      circuitStateKey('ollama'),
      JSON.stringify({
        failures: [t0 - 50_000, t0 - 45_000, t0 - 30_000, t0 - 25_000],
        failureKinds: ['rate_limited', 'rate_limited'],
        openedAt: null,
      }),
    );
    await redis.sadd(AI_CIRCUIT_IDS_KEY, 'ollama');

    // Salen de la ventana los dos más antiguos (los completados con `unavailable`).
    clock.advance(20_000);
    for (let i = 0; i < 3; i++) {
      await breaker.recordFailure('ollama', { kind: 'rejected' });
    }

    expect((await breaker.openConditions()).get('ollama')).toEqual({
      kind: 'rate_limited',
    });
  });

  it('no new key gets an expiry', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const breaker = new RedisCircuitBreaker(redis, clock);
    for (let i = 0; i < 5; i++) {
      await breaker.recordFailure('ollama', { kind: 'rate_limited' });
    }
    clock.advance(30_000);
    await breaker.tryAcquire('ollama');
    await breaker.recordFailure('ollama', { kind: 'rejected' });
    await breaker.openConditions();

    const expiring = redis.setCalls.filter((call) => call.px !== undefined);
    expect(expiring.length).toBeGreaterThan(0);
    expect(
      expiring.every((call) => call.key === circuitProbeKey('ollama')),
    ).toBe(true);
  });

  it('openConditions returns an empty map when Redis fails', async () => {
    const clock = new FakeClock();
    const redis = new FakeRedis(clock);
    const breaker = new RedisCircuitBreaker(redis, clock);
    for (let i = 0; i < 5; i++) await breaker.recordFailure('ollama');

    redis.failNext = true;

    expect(await breaker.openConditions()).toEqual(new Map());
  });
});
