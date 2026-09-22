import { describe, expect, it, vi } from 'vitest';
import type { CircuitBreaker } from '../domain/ports/circuit-breaker.port';
import type {
  LlmProvider,
  ProviderCapabilities,
} from '../domain/ports/llm-provider.port';
import { DefaultProviderEligibility } from './provider-eligibility';

// Tarea 4.3: consulta de solo lectura; distingue «no hay ninguno» de «no se pudo responder».

const baseCapabilities: ProviderCapabilities = {
  jsonMode: true,
  toolUse: false,
  maxContextTokens: 32_000,
  external: false,
  costPer1kIn: 0,
  costPer1kOut: 0,
};

function provider(
  id: string,
  capabilities: Partial<ProviderCapabilities> = {},
): LlmProvider {
  return {
    id,
    capabilities: { ...baseCapabilities, ...capabilities },
    complete: vi.fn(() => Promise.reject(new Error('must not be called'))),
    healthy: vi.fn(() => Promise.resolve(true)),
  };
}

function breakerWith(
  openIds: ReadonlySet<string> | null,
): CircuitBreaker {
  return {
    openIds: async () => openIds ?? new Set(),
    snapshotOpenIds: async () => openIds,
    tryAcquire: async () => true,
    recordSuccess: async () => undefined,
    recordFailure: async () => undefined,
    release: async () => undefined,
  };
}

describe('DefaultProviderEligibility', () => {
  it('reports an eligible provider when the chain is non-empty', async () => {
    const ollama = provider('ollama');
    const eligibility = new DefaultProviderEligibility(
      [ollama],
      breakerWith(new Set()),
    );

    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {}, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: false },
      }),
    ).resolves.toEqual({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });
    expect(ollama.complete).not.toHaveBeenCalled();
    expect(ollama.healthy).not.toHaveBeenCalled();
  });

  it('reports no eligible provider when the chain is empty', async () => {
    const openrouter = provider('openrouter', { external: true });
    const eligibility = new DefaultProviderEligibility(
      [openrouter],
      breakerWith(new Set()),
    );

    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {}, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: false },
      }),
    ).resolves.toEqual({
      status: 'ready',
      hasEligible: false,
      hasEligibleByok: false,
      consentWouldEnable: true,
    });
    expect(openrouter.complete).not.toHaveBeenCalled();
    expect(openrouter.healthy).not.toHaveBeenCalled();
  });

  it('returns unavailable when the circuit snapshot cannot be read', async () => {
    const ollama = provider('ollama');
    const eligibility = new DefaultProviderEligibility(
      [ollama],
      breakerWith(null),
    );

    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {} },
        aiConsent: { externalProviders: true },
      }),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(ollama.complete).not.toHaveBeenCalled();
    expect(ollama.healthy).not.toHaveBeenCalled();
  });

  it('never contacts a provider in any of the three outcomes', async () => {
    const local = provider('ollama');
    const external = provider('openrouter', { external: true });
    const providers = [local, external];

    for (const openIds of [new Set<string>(), new Set(['ollama']), null]) {
      const eligibility = new DefaultProviderEligibility(
        providers,
        breakerWith(openIds),
      );
      await eligibility.hasEligibleProvider({
        task: { requires: {}, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: false },
      });
    }

    for (const p of providers) {
      expect(p.complete).not.toHaveBeenCalled();
      expect(p.healthy).not.toHaveBeenCalled();
    }
  });

  it('includes BYOK of the userId and ignores another user keys (D11)', async () => {
    const platform = provider('ollama');
    const anaByok = provider('byok:ana:openai', { external: true });
    const eligibility = new DefaultProviderEligibility({
      platformProviders: [platform],
      breaker: breakerWith(new Set()),
      byokFactory: {
        providersFor: async (userId) =>
          userId === 'ana' ? [anaByok] : [],
      },
    });

    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {}, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: true },
        userId: 'ana',
      }),
    ).resolves.toEqual({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: true,
      consentWouldEnable: false,
    });

    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {}, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: true },
        userId: 'beto',
      }),
    ).resolves.toEqual({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });

    expect(anaByok.complete).not.toHaveBeenCalled();
  });

  it('reports hasEligible via BYOK alone when AI_CHAIN is empty (match vigencia D11)', async () => {
    const anaByok = provider('byok:ana:openai', { external: true });
    const eligibility = new DefaultProviderEligibility({
      platformProviders: [],
      breaker: breakerWith(new Set()),
      byokFactory: {
        providersFor: async (userId) =>
          userId === 'ana' ? [anaByok] : [],
      },
    });

    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: { jsonMode: true }, dataSensitivity: 'personal' },
        aiConsent: { externalProviders: true },
        userId: 'ana',
      }),
    ).resolves.toEqual({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: true,
      consentWouldEnable: false,
    });
  });
});
