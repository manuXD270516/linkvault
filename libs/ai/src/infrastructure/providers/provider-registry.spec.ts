import { describe, expect, it } from 'vitest';
import { TaskRegistry, type AnyAiTask } from '../../application/task-registry';
import { RunTask } from '../../application/run-task.usecase';
import {
  InMemoryAiLogger,
  InMemoryPromptRegistry,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
} from '../../application/testing/in-memory-ports';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import type { AiConfig, AiProviderId } from '../config/ai-config.schema';
import { parseAiConfig, type AiEnv } from '../config/parse-ai-config';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import { MockDeterministicProvider } from './mock-deterministic.provider';
import { OllamaProvider } from './ollama.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { buildProviders, IncompleteProviderConfig } from './provider-registry';

// Requisito "Cadena limitada por configuración" (specs/ai/provider-routing) y D6 y D12 de ai-gateway-core: los
// proveedores salen de una configuración validada por parseAiConfig.

const BASE_ENV: AiEnv = {
  NODE_ENV: 'test',
  AI_MOCK_MODE: 'replay',
  OLLAMA_URL: 'http://127.0.0.1:11434',
  OLLAMA_MAX_CONTEXT_TOKENS: '4096',
  OLLAMA_TIMEOUT_MS: '45000',
  OPENROUTER_API_KEY: 'sk-or-v1-provider-registry-test',
  OPENROUTER_MODEL: 'cohere/north-mini-code:free',
  OPENROUTER_MAX_CONTEXT_TOKENS: '16000',
  OPENROUTER_TIMEOUT_MS: '20000',
};

function configFor(chain: string): AiConfig {
  const result = parseAiConfig({ ...BASE_ENV, AI_CHAIN: chain });
  if (!result.ok) {
    throw new Error(`invalid test config: ${JSON.stringify(result.problems)}`);
  }
  return result.config;
}

const tasks = new TaskRegistry([classifySkillsTask as unknown as AnyAiTask]);

/** Todas las cadenas ordenadas sin repetición de mock, ollama y openrouter. */
function arrangements(ids: readonly AiProviderId[]): AiProviderId[][] {
  const result: AiProviderId[][] = [];
  const walk = (prefix: AiProviderId[], rest: readonly AiProviderId[]) => {
    if (prefix.length > 0) result.push(prefix);
    rest.forEach((id, index) =>
      walk(
        [...prefix, id],
        rest.filter((_, other) => other !== index),
      ),
    );
  };
  walk([], ids);
  return result;
}

const EXPECTED_CLASS = {
  mock: MockDeterministicProvider,
  ollama: OllamaProvider,
  openrouter: OpenRouterProvider,
} as const;

describe('buildProviders', () => {
  const chains = arrangements(['mock', 'ollama', 'openrouter']);

  it('covers the 15 possible AI_CHAIN lists', () => {
    expect(chains).toHaveLength(15);
  });

  it.each(chains.map((chain) => [chain.join(',')]))(
    'builds AI_CHAIN=%s in order with its settings',
    (chain) => {
      const ids = chain.split(',') as AiProviderId[];
      const { providers, timeoutsMs } = buildProviders(configFor(chain), {
        tasks,
      });

      expect(providers.map((p) => p.id)).toEqual(ids);
      providers.forEach((provider, index) => {
        const id = ids[index] as AiProviderId;
        expect(provider).toBeInstanceOf(EXPECTED_CLASS[id]);
      });

      const expectedTimeouts: Record<string, number> = {};
      if (ids.includes('ollama')) expectedTimeouts['ollama'] = 45_000;
      if (ids.includes('openrouter')) expectedTimeouts['openrouter'] = 20_000;
      expect(timeoutsMs).toEqual(expectedTimeouts);

      const byId = new Map(providers.map((p) => [p.id, p]));
      expect(byId.get('ollama')?.capabilities).toMatchObject(
        ids.includes('ollama')
          ? { maxContextTokens: 4096, external: false }
          : {},
      );
      expect(byId.get('openrouter')?.capabilities).toMatchObject(
        ids.includes('openrouter')
          ? { maxContextTokens: 16_000, external: true }
          : {},
      );
      expect(byId.get('mock')?.capabilities).toMatchObject(
        ids.includes('mock') ? { maxContextTokens: 1_000_000 } : {},
      );
    },
  );

  it('builds an empty chain for AI_CHAIN=none', () => {
    expect(buildProviders(configFor('none'), { tasks })).toEqual({
      providers: [],
      timeoutsMs: {},
    });
  });

  it('builds the mock in synth mode from the config', async () => {
    const result = parseAiConfig({
      ...BASE_ENV,
      AI_CHAIN: 'mock',
      AI_MOCK_MODE: 'synth',
    });
    if (!result.ok) throw new Error('invalid test config');
    const [mock] = buildProviders(result.config, { tasks }).providers;

    // Synth sin fixture: solo es posible si recibió el registro de tareas.
    const completion = await mock?.complete({
      system: 's',
      user: 'u',
      trace: {
        taskName: 'classify-skills',
        promptVersion: 'v1',
        key: 'e'.repeat(64),
        input: { text: 'TypeScript' },
      },
    });
    expect(completion?.model).toBe('mock-synth');
  });

  it('fails clearly when a chained provider has no configuration block', () => {
    expect(() => buildProviders({ chain: ['openrouter'] }, { tasks })).toThrow(
      IncompleteProviderConfig,
    );
  });

  it('Sin IA configurada', async () => {
    const { providers, timeoutsMs } = buildProviders(configFor('none'), {
      tasks,
    });
    const ledger = new InMemoryUsageLedger();
    const prompts = new InMemoryPromptRegistry();
    const clock = new ManualClock();
    const runTask = new RunTask({
      providers,
      providerTimeoutsMs: timeoutsMs,
      prompts,
      cache: new InMemoryResultCache(),
      ledger,
      quota: new InMemoryQuotaPolicy(),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      logger: new InMemoryAiLogger(),
    });

    const result = await runTask.execute(
      classifySkillsTask,
      { text: 'Backend con TypeScript y NestJS' },
      { aiConsent: { externalProviders: true } },
    );

    expect(result).toEqual({ status: 'degraded', reason: 'no_providers' });
    expect(prompts.rendered).toEqual([]);
    expect(ledger.records).toEqual([
      expect.objectContaining({
        outcome: 'degraded',
        reason: 'no_providers',
        providerId: null,
      }),
    ]);
  });
});
