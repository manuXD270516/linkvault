import { describe, expect, it } from 'vitest';
import type {
  LlmProvider,
  ProviderCapabilities,
} from './ports/llm-provider.port';
import { buildChain, satisfies, type ChainRequest } from './routing-policy';
import { dataSensitivityOf } from './task';

// Escenarios de specs/ai/provider-routing/spec.md y specs/ai/data-protection/spec.md (change ai-gateway-core).

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
    complete: () => Promise.reject(new Error('not used by a pure policy')),
    healthy: () => Promise.resolve(true),
  };
}

function chainIds(
  overrides: Partial<ChainRequest> & Pick<ChainRequest, 'providers'>,
): string[] {
  return buildChain({
    task: { requires: {} },
    ctx: { aiConsent: { externalProviders: true } },
    openIds: new Set(),
    ...overrides,
  }).providers.map((p) => p.id);
}

describe('satisfies', () => {
  const cases: ReadonlyArray<
    [
      string,
      Partial<ProviderCapabilities>,
      Partial<ProviderCapabilities>,
      boolean,
    ]
  > = [
    [
      'required jsonMode missing',
      { jsonMode: false },
      { jsonMode: true },
      false,
    ],
    ['required jsonMode present', { jsonMode: true }, { jsonMode: true }, true],
    ['jsonMode not required', { jsonMode: false }, { jsonMode: false }, true],
    ['required toolUse missing', { toolUse: false }, { toolUse: true }, false],
    [
      'context below required',
      { maxContextTokens: 7_999 },
      { maxContextTokens: 8_000 },
      false,
    ],
    [
      'context equal to required',
      { maxContextTokens: 8_000 },
      { maxContextTokens: 8_000 },
      true,
    ],
    [
      'costs are policy, not capability',
      { costPer1kOut: 5 },
      { costPer1kOut: 0 },
      true,
    ],
    [
      'external is policy, not capability',
      { external: true },
      { external: false },
      true,
    ],
  ];

  it.each(cases)('%s', (_label, capabilities, requires, expected) => {
    expect(satisfies({ ...baseCapabilities, ...capabilities }, requires)).toBe(
      expected,
    );
  });
});

describe('buildChain', () => {
  it('Capacidad insuficiente', () => {
    const ids = chainIds({
      task: { requires: { jsonMode: true } },
      providers: [provider('no-json', { jsonMode: false }), provider('json')],
    });

    expect(ids).toEqual(['json']);
  });

  it('Sin consentimiento en una tarea personal', () => {
    const ids = chainIds({
      task: { requires: {}, dataSensitivity: 'personal' },
      ctx: { aiConsent: { externalProviders: false } },
      providers: [
        provider('openrouter', { external: true }),
        provider('ollama'),
      ],
    });

    expect(ids).toEqual(['ollama']);
  });

  it('treats a task without declared sensitivity as personal when there is no consent', () => {
    const ids = chainIds({
      task: { requires: {} },
      ctx: { aiConsent: { externalProviders: false } },
      providers: [
        provider('openrouter', { external: true }),
        provider('ollama'),
      ],
    });

    expect(ids).toEqual(['ollama']);
  });

  it('Tarea pública sin consentimiento', () => {
    const ids = chainIds({
      task: { requires: {}, dataSensitivity: 'public' },
      ctx: { aiConsent: { externalProviders: false } },
      providers: [
        provider('openrouter', { external: true }),
        provider('ollama'),
      ],
    });

    expect(ids).toContain('openrouter');
    expect(ids).toContain('ollama');
  });

  it('keeps external providers for a personal task with consent', () => {
    const ids = chainIds({
      task: { requires: {}, dataSensitivity: 'personal' },
      ctx: { aiConsent: { externalProviders: true } },
      providers: [provider('openrouter', { external: true })],
    });

    expect(ids).toEqual(['openrouter']);
  });

  it('excludes providers whose circuit is open', () => {
    const ids = chainIds({
      providers: [provider('ollama'), provider('mock')],
      openIds: new Set(['ollama']),
    });

    expect(ids).toEqual(['mock']);
  });

  it('Proveedor gratuito antes que uno de pago', () => {
    const ids = chainIds({
      providers: [
        provider('paid', { external: true, costPer1kOut: 0.6 }),
        provider('free', { external: true, costPer1kOut: 0 }),
      ],
    });

    expect(ids).toEqual(['free', 'paid']);
  });

  it('Local antes que remoto a igual coste', () => {
    // AI_CHAIN=openrouter,ollama; OpenRouter con más contexto para comprobar que la localidad pesa antes.
    const ids = chainIds({
      providers: [
        provider('openrouter', { external: true, maxContextTokens: 128_000 }),
        provider('ollama', { external: false, maxContextTokens: 8_192 }),
      ],
    });

    expect(ids).toEqual(['ollama', 'openrouter']);
  });

  it('puts BYOK providers first even when they cost more', () => {
    const ids = chainIds({
      providers: [
        provider('ollama'),
        provider('byok:user-1:openai', { external: true, costPer1kOut: 0.6 }),
      ],
    });

    expect(ids).toEqual(['byok:user-1:openai', 'ollama']);
  });

  it('prefers the larger context at equal cost and locality', () => {
    const ids = chainIds({
      providers: [
        provider('small', { maxContextTokens: 8_000 }),
        provider('large', { maxContextTokens: 64_000 }),
      ],
    });

    expect(ids).toEqual(['large', 'small']);
  });

  it('falls back to the AI_CHAIN order on a full tie', () => {
    const ids = chainIds({
      providers: [provider('b'), provider('a'), provider('c')],
    });

    expect(ids).toEqual(['b', 'a', 'c']);
  });

  it('returns an empty chain when nothing is eligible', () => {
    expect(chainIds({ providers: [] })).toEqual([]);
  });
});

describe('dataSensitivityOf', () => {
  it('Tarea sin sensibilidad declarada', () => {
    expect(dataSensitivityOf({})).toBe('personal');
    expect(dataSensitivityOf({ dataSensitivity: 'public' })).toBe('public');
  });
});
