import { describe, expect, it } from 'vitest';
import type { Clock } from '../../domain/ports/clock.port';
import type {
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';
import { buildChain } from '../../domain/routing-policy';
import { InMemoryCircuitBreaker } from './in-memory-circuit-breaker';

// Requisito "Circuit breaker por proveedor" (specs/ai/provider-routing) y D10 de ai-gateway-core.
// Reloj falso: sin esperas reales.

class FakeClock implements Clock {
  private current = 1_700_000_000_000;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
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
  breaker: InMemoryCircuitBreaker,
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
  breaker: InMemoryCircuitBreaker,
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

describe('InMemoryCircuitBreaker', () => {
  const ollama = provider('ollama');
  const openrouter = provider('openrouter');

  it('Apertura tras fallos repetidos', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);

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
    const breaker = new InMemoryCircuitBreaker(clock);

    await failTimes(breaker, 'ollama', 5, clock, 15_000);

    expect((await breaker.openIds()).size).toBe(0);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
  });

  it('stays open for 30 seconds and then admits a probe', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);
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
    const breaker = new InMemoryCircuitBreaker(clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_001);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    await breaker.recordSuccess('ollama');

    expect((await breaker.openIds()).size).toBe(0);
    expect(await chainIds(breaker, [ollama, openrouter])).toContain('ollama');
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    expect(await breaker.tryAcquire('ollama')).toBe(true);

    // Cerrado de nuevo con la ventana vacía: hacen falta otros 5 errores para reabrir.
    await failTimes(breaker, 'ollama', 4);
    expect((await breaker.openIds()).size).toBe(0);
  });

  it('grants a single probe permit while a probe is in flight', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_000);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    expect(await breaker.tryAcquire('ollama')).toBe(false);
    expect((await breaker.openIds()).has('ollama')).toBe(true);
  });

  it('reopens when the half-open probe fails', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);
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

  it('Permiso de prueba no usado', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_000);

    // Ejecución resuelta por un proveedor anterior en la cadena: nunca se llama a tryAcquire('ollama').
    expect(await chainIds(breaker, [openrouter, ollama])).toContain('ollama');
    expect(await breaker.tryAcquire('openrouter')).toBe(true);
    await breaker.recordSuccess('openrouter');

    clock.advance(60_000);
    expect((await breaker.openIds()).has('ollama')).toBe(false);
    expect(await chainIds(breaker, [openrouter, ollama])).toContain('ollama');
    expect(await breaker.tryAcquire('ollama')).toBe(true);
  });

  it('release returns a granted half-open permit so a new tryAcquire gets it again', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    await failTimes(breaker, 'ollama', 5);
    clock.advance(30_000);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    expect(await breaker.tryAcquire('ollama')).toBe(false);

    await breaker.release('ollama');

    expect((await breaker.openIds()).has('ollama')).toBe(false);
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    // Sigue en half-open: un fallo de la nueva prueba reabre.
    await breaker.recordFailure('ollama');
    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
  });

  it('release without a granted permit does nothing', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);

    // Cerrado: no toca la ventana de errores.
    await failTimes(breaker, 'ollama', 4);
    await breaker.release('ollama');
    await breaker.release('unknown');
    await breaker.recordFailure('ollama');
    expect(await breaker.openIds()).toEqual(new Set(['ollama']));

    // Abierto sin estar listo para prueba: sigue abierto.
    clock.advance(10_000);
    await breaker.release('ollama');
    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
    expect(await breaker.tryAcquire('ollama')).toBe(false);

    // Half-open sin permiso tomado: el permiso sigue siendo único.
    clock.advance(20_000);
    await breaker.release('ollama');
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    expect(await breaker.tryAcquire('ollama')).toBe(false);
  });

  it('ignores a late failure from a request started before the circuit opened', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    await failTimes(breaker, 'ollama', 5);

    clock.advance(20_000);
    await breaker.recordFailure('ollama');
    clock.advance(10_000);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
  });

  it('keeps circuits independent per provider', async () => {
    const clock = new FakeClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    await failTimes(breaker, 'ollama', 5);
    await failTimes(breaker, 'openrouter', 4);

    expect(await breaker.openIds()).toEqual(new Set(['ollama']));
    expect(await breaker.tryAcquire('openrouter')).toBe(true);
  });
});
