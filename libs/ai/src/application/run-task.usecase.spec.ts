import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import type {
  CircuitBreaker,
  ProviderFailure,
} from '../domain/ports/circuit-breaker.port';
import type { LlmProvider } from '../domain/ports/llm-provider.port';
import type { RenderedPrompt } from '../domain/ports/prompt-registry.port';
import type { RunContext } from '../domain/run-context';
import {
  FixtureMissing,
  InvalidDegradeOutput,
  InvalidFixture,
  InvalidPrompt,
  MockMisuse,
  ProviderUnavailable,
  SynthUnsupported,
} from '../domain/errors';
import type { AiTask } from '../domain/task';
import {
  classifySkillsTask,
  type ClassifySkillsOutput,
} from '../tasks/classify-skills.task';
import { InMemoryCircuitBreaker } from '../infrastructure/resilience/in-memory-circuit-breaker';
import { executionKey } from './execution-key';
import { RunTask, type RunTaskDeps } from './run-task.usecase';
import { FakeLlmProvider } from './testing/fake-llm-provider';
import {
  InMemoryAiLogger,
  InMemoryPromptRegistry,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
  RecordingNullCircuitBreaker,
} from './testing/in-memory-ports';

// Escenarios de specs/ai/task-execution, usage-accounting y data-protection sobre puertos en memoria.

const CONSENT: RunContext = { aiConsent: { externalProviders: true } };
const INPUT = { text: 'Backend con TypeScript y NestJS' };
const VALID_OUTPUT = {
  skills: [
    { name: 'TypeScript', category: 'language' },
    { name: 'NestJS', category: 'framework' },
  ],
};
const VALID = JSON.stringify(VALID_OUTPUT);

interface Harness {
  runTask: RunTask;
  deps: RunTaskDeps & {
    prompts: InMemoryPromptRegistry;
    cache: InMemoryResultCache;
    ledger: InMemoryUsageLedger;
    quota: InMemoryQuotaPolicy;
    breaker: RecordingNullCircuitBreaker;
    clock: ManualClock;
    logger: InMemoryAiLogger;
  };
}

/** Registro de prompts cuyo `render` rechaza con el error dado. */
class FailingRenderPromptRegistry extends InMemoryPromptRegistry {
  constructor(private readonly failure: Error) {
    super();
  }

  override render(): Promise<RenderedPrompt> {
    return Promise.reject(this.failure);
  }
}

/** Registro de prompts cuyo `render` falla como un prompt que no puede renderizarse. */
class InvalidPromptRegistry extends FailingRenderPromptRegistry {
  constructor() {
    super(
      new InvalidPrompt(
        'classify-skills',
        'v1',
        'template is not valid Mustache',
      ),
    );
  }
}

function harness(
  providers: readonly LlmProvider[],
  overrides: Partial<Omit<Harness['deps'], 'breaker'>> & {
    breaker?: CircuitBreaker;
  } = {},
): Harness {
  const deps = {
    providers,
    prompts: new InMemoryPromptRegistry(),
    cache: new InMemoryResultCache(),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new RecordingNullCircuitBreaker(),
    clock: new ManualClock(),
    logger: new InMemoryAiLogger(),
    // Varios de estos tests esperan la ausencia de un fixture a propósito: quedan fuera del registro de pendientes (4.6).
    pendingFixtures: null,
    ...overrides,
  };
  // Con un breaker real inyectado, los tests no leen las listas de RecordingNullCircuitBreaker.
  return { runTask: new RunTask(deps), deps: deps as Harness['deps'] };
}

describe('RunTask: main path', () => {
  it('Ejecución correcta de una tarea declarada', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID], {
      model: 'qwen2.5:7b',
    });
    const { runTask } = harness([provider]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'success',
      output: VALID_OUTPUT,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      promptVersion: 'v1',
      cached: false,
    });
  });

  it('Input inválido', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider]);

    await expect(
      runTask.execute(classifySkillsTask, { text: '' }, CONSENT),
    ).rejects.toBeInstanceOf(ZodError);
    expect(provider.calls).toBe(0);
  });

  it('Proveedor con modo JSON', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID], {
      capabilities: { jsonMode: true },
    });
    const { runTask } = harness([provider]);

    await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(provider.requests[0]).toMatchObject({
      temperature: 0,
      responseFormat: 'json',
      maxTokens: 1_024,
    });
  });

  it('asks for text format from a provider without JSON mode', async () => {
    const provider = new FakeLlmProvider('plain', [VALID], {
      capabilities: { jsonMode: false },
    });
    const { runTask } = harness([provider]);

    await runTask.execute(
      { ...classifySkillsTask, requires: {} },
      INPUT,
      CONSENT,
    );

    expect(provider.requests[0]?.responseFormat).toBe('text');
  });

  it('sends the execution key in trace, computed on the parsed input with the output language', async () => {
    const provider = new FakeLlmProvider('mock', [VALID]);
    const { runTask } = harness([provider]);

    await runTask.execute(
      classifySkillsTask,
      { ...INPUT, ignored: 'stripped by zod' } as typeof INPUT,
      { ...CONSENT, outputLanguage: 'en' },
    );

    expect(provider.requests[0]?.trace).toEqual({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      key: executionKey({
        taskName: 'classify-skills',
        promptVersion: 'v1',
        outputLanguage: 'en',
        input: INPUT,
      }),
      // Solo el mock recibe el input parseado (D4).
      input: INPUT,
    });
    expect(provider.requests[0]?.user).not.toContain('stripped by zod');
  });

  it('never sends trace.input to a real provider, local or external', async () => {
    const external = new FakeLlmProvider('openrouter', [new Error('down')], {
      capabilities: { external: true },
    });
    const local = new FakeLlmProvider('ollama', [VALID], {
      capabilities: { costPer1kOut: 0.1 },
    });
    const { runTask } = harness([local, external]);

    await runTask.execute(
      classifySkillsTask,
      { text: 'ana@example.com TypeScript' },
      CONSENT,
    );

    for (const request of [...external.requests, ...local.requests]) {
      expect(request.trace).toBeDefined();
      expect(request.trace).not.toHaveProperty('input');
    }
    expect(external.calls).toBe(1);
    expect(local.calls).toBe(1);
  });

  it('renders the prompt with the validated input and the default language', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([provider]);

    await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(provider.requests[0]).toMatchObject({
      system: 'classify-skills@v1 lang=es',
      user: JSON.stringify(INPUT),
    });
    expect(deps.prompts.rendered).toHaveLength(1);
  });

  it('follows the routing policy order and filters', async () => {
    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const local = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([external, local]);

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      aiConsent: { externalProviders: false },
    });

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
    expect(external.calls).toBe(0);
  });
});

const INVALID = '{"skills":[{"name":"","category":"language"}]}';

describe('RunTask: fallback and typed degradation', () => {
  it('JSON inválido también tras la reparación', async () => {
    const first = new FakeLlmProvider('ollama', [INVALID, INVALID]);
    const second = new FakeLlmProvider('mock', [VALID]);
    const { runTask, deps } = harness([first, second]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(first.calls).toBe(2);
    expect(result).toMatchObject({
      status: 'success',
      providerId: 'mock',
      output: VALID_OUTPUT,
    });
    expect(deps.ledger.records.map((r) => [r.providerId, r.outcome])).toEqual([
      ['ollama', 'schema_error'],
      ['mock', 'success'],
    ]);
  });

  it('falls back to the next provider after a provider error', async () => {
    const failing = new FakeLlmProvider('ollama', [new Error('ECONNREFUSED')]);
    const healthy = new FakeLlmProvider('mock', [VALID]);
    const { runTask, deps } = harness([failing, healthy]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success', providerId: 'mock' });
    expect(deps.logger.warnings).toEqual([
      {
        level: 'warn',
        message: 'AI provider error',
        fields: {
          task: 'classify-skills',
          providerId: 'ollama',
          httpStatus: undefined,
          error: 'Error',
        },
      },
    ]);
  });

  it('Cadena agotada sin función de degradación', async () => {
    const providers = [
      new FakeLlmProvider('ollama', [new Error('down')]),
      new FakeLlmProvider('openrouter', ['no json', 'still no json']),
    ];
    const { runTask } = harness(providers);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(result).not.toHaveProperty('output');
  });

  it('Cadena agotada con función de degradación', async () => {
    const task = {
      ...classifySkillsTask,
      degrade: () => ({
        skills: [{ name: 'TypeScript', category: 'language' as const }],
      }),
    };
    const { runTask } = harness([
      new FakeLlmProvider('ollama', [new Error('down')]),
    ]);

    const result = await runTask.execute(task, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      output: { skills: [{ name: 'TypeScript', category: 'language' }] },
      providerCondition: { kind: 'unavailable' },
    });
  });

  it('Función de degradación con salida inválida', async () => {
    const task = {
      ...classifySkillsTask,
      degrade: () => ({
        skills: [{ name: '', category: 'language' as const }],
      }),
    };
    const { runTask } = harness([
      new FakeLlmProvider('ollama', [new Error('down')]),
    ]);

    const run = runTask.execute(task, INPUT, CONSENT);

    await expect(run).rejects.toBeInstanceOf(InvalidDegradeOutput);
    await expect(run).rejects.toThrow(/classify-skills/);
  });

  it('Ningún proveedor elegible', async () => {
    const withoutJson = new FakeLlmProvider('plain', [VALID], {
      capabilities: { jsonMode: false },
    });
    const { runTask, deps } = harness([withoutJson]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({ status: 'degraded', reason: 'no_providers' });
    expect(withoutJson.calls).toBe(0);
    expect(deps.ledger.records.map((r) => [r.outcome, r.reason])).toEqual([
      ['degraded', 'no_providers'],
    ]);
  });

  it('Sin IA configurada', async () => {
    const { runTask } = harness([]);

    await expect(
      runTask.execute(classifySkillsTask, INPUT, CONSENT),
    ).resolves.toEqual({ status: 'degraded', reason: 'no_providers' });
  });
});

describe('RunTask: degraded reason precedence', () => {
  it('Faltaba el consentimiento y el permiso era la diferencia', async () => {
    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([external]);

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      aiConsent: { externalProviders: false },
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'consent_required',
    });
    expect(external.calls).toBe(0);
  });

  it('Faltaba el consentimiento pero no habría cambiado nada', async () => {
    const local = new FakeLlmProvider('ollama', [VALID], {
      capabilities: { jsonMode: false },
    });
    const { runTask } = harness([local]);

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      aiConsent: { externalProviders: false },
    });

    expect(result).toEqual({ status: 'degraded', reason: 'no_providers' });
    expect(local.calls).toBe(0);
  });

  it('Sin consentimiento, con un proveedor local que falla', async () => {
    const local = new FakeLlmProvider('ollama', [new Error('down')]);
    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([local, external]);

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      aiConsent: { externalProviders: false },
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(local.calls).toBe(1);
    expect(external.calls).toBe(0);
  });

  it('Los cuatro motivos se distinguen entre sí', async () => {
    const reasons = new Set([
      'no_providers',
      'providers_failed',
      'quota_exceeded',
      'consent_required',
    ]);
    expect(reasons.size).toBe(4);
    expect(reasons.has('consent_required')).toBe(true);
    expect(reasons.has('no_providers')).toBe(true);
  });

  it('El instante de vuelta no acompaña a otro motivo', async () => {
    const { runTask: empty } = harness([]);
    const noProviders = await empty.execute(classifySkillsTask, INPUT, CONSENT);

    const failing = new FakeLlmProvider('ollama', [new Error('down')]);
    const { runTask: failRun } = harness([failing]);
    const providersFailed = await failRun.execute(
      classifySkillsTask,
      INPUT,
      CONSENT,
    );

    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask: consentRun } = harness([external]);
    const consentRequired = await consentRun.execute(
      classifySkillsTask,
      INPUT,
      {
        aiConsent: { externalProviders: false },
      },
    );

    expect(noProviders).toEqual({ status: 'degraded', reason: 'no_providers' });
    expect(providersFailed).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(consentRequired).toEqual({
      status: 'degraded',
      reason: 'consent_required',
    });
    expect(noProviders).not.toHaveProperty('aiQuotaRetryAt');
    expect(providersFailed).not.toHaveProperty('aiQuotaRetryAt');
    expect(consentRequired).not.toHaveProperty('aiQuotaRetryAt');
  });
});

describe('RunTask: errors that propagate instead of degrading', () => {
  it('Fixture ausente en CI', async () => {
    const key = executionKey({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: INPUT,
    });
    const mock = new FakeLlmProvider('mock', [new FixtureMissing(key)]);
    const next = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([mock, next]);

    const run = runTask.execute(classifySkillsTask, INPUT, CONSENT);

    await expect(run).rejects.toBeInstanceOf(FixtureMissing);
    await expect(run).rejects.toMatchObject({ key });
    expect(next.calls).toBe(0);
    expect(deps.ledger.records.map((r) => r.outcome)).not.toContain('degraded');
  });

  it.each([
    ['MockMisuse', () => new MockMisuse('trace missing')],
    ['InvalidFixture', () => new InvalidFixture('classify-skills', 'k')],
    ['SynthUnsupported', () => new SynthUnsupported('classify-skills')],
    [
      'InvalidPrompt',
      () =>
        new InvalidPrompt(
          'classify-skills',
          'v1',
          'template is not valid Mustache',
        ),
    ],
  ])(
    'propagates the programming error %s without trying the next provider',
    async (name, makeError) => {
      const mock = new FakeLlmProvider('mock', [makeError()]);
      const next = new FakeLlmProvider('ollama', [VALID]);
      const { runTask, deps } = harness([mock, next]);

      await expect(
        runTask.execute(classifySkillsTask, INPUT, CONSENT),
      ).rejects.toMatchObject({ name });
      expect(next.calls).toBe(0);
      expect(deps.breaker.failures).toEqual([]);
      expect(deps.breaker.released).toEqual(['mock']);
      expect(deps.ledger.records).toEqual([]);
    },
  );

  it('propagates InvalidPrompt raised while rendering without degrading or touching the breaker', async () => {
    const prompts = new InvalidPromptRegistry();
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const next = new FakeLlmProvider('zeta', [VALID]);
    const task = { ...classifySkillsTask, degrade: () => ({ skills: [] }) };
    const { runTask, deps } = harness([provider, next], { prompts });

    await expect(runTask.execute(task, INPUT, CONSENT)).rejects.toBeInstanceOf(
      InvalidPrompt,
    );
    expect(provider.calls).toBe(0);
    expect(next.calls).toBe(0);
    expect(deps.breaker.acquired).toEqual([]);
    expect(deps.breaker.failures).toEqual([]);
    expect(deps.breaker.released).toEqual([]);
    expect(deps.ledger.records).toEqual([]);
  });

  it('wraps any other render failure in InvalidPrompt without leaking its message', async () => {
    const prompts = new FailingRenderPromptRegistry(
      new Error('boom ana.perez@example.com'),
    );
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const task = { ...classifySkillsTask, degrade: () => ({ skills: [] }) };
    const { runTask, deps } = harness([provider], { prompts });

    const error = await runTask
      .execute(task, INPUT, CONSENT)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(InvalidPrompt);
    expect(error).toMatchObject({
      taskName: 'classify-skills',
      promptVersion: 'v1',
    });
    expect((error as Error).message).not.toContain('boom');
    expect((error as Error).message).not.toContain('ana.perez@example.com');
    expect(provider.calls).toBe(0);
    expect(deps.ledger.records).toEqual([]);
    expect(deps.breaker.acquired).toEqual([]);
    expect(deps.breaker.failures).toEqual([]);
    expect(deps.breaker.released).toEqual([]);
  });

  it('leaves the half-open permit available when rendering raises InvalidPrompt', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    for (let i = 0; i < 5; i++) await breaker.recordFailure('ollama');
    clock.advance(30_000);
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const broken = harness([provider], {
      clock,
      breaker,
      prompts: new InvalidPromptRegistry(),
    });

    await expect(
      broken.runTask.execute(classifySkillsTask, INPUT, CONSENT),
    ).rejects.toBeInstanceOf(InvalidPrompt);

    expect((await breaker.openIds()).size).toBe(0);
    const healthy = harness([provider], { clock, breaker });
    await expect(
      healthy.runTask.execute(classifySkillsTask, INPUT, CONSENT),
    ).resolves.toMatchObject({ status: 'success', providerId: 'ollama' });
  });

  it('returns the half-open permit when a programming error is raised after acquiring it', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    for (let i = 0; i < 5; i++) await breaker.recordFailure('ollama');
    clock.advance(30_000);
    const provider = new FakeLlmProvider('ollama', [
      new InvalidPrompt('classify-skills', 'v1', 'broken'),
      VALID,
    ]);
    const { runTask } = harness([provider], { clock, breaker });

    await expect(
      runTask.execute(classifySkillsTask, INPUT, CONSENT),
    ).rejects.toBeInstanceOf(InvalidPrompt);

    expect(await breaker.tryAcquire('ollama')).toBe(true);
    await breaker.release('ollama');
    await expect(
      runTask.execute(classifySkillsTask, INPUT, CONSENT),
    ).resolves.toMatchObject({ status: 'success', providerId: 'ollama' });
  });

  it('propagates FixtureMissing raised during the repair request', async () => {
    const mock = new FakeLlmProvider('mock', [
      INVALID,
      new FixtureMissing('k'),
    ]);
    const { runTask } = harness([mock]);

    await expect(
      runTask.execute(classifySkillsTask, INPUT, CONSENT),
    ).rejects.toBeInstanceOf(FixtureMissing);
  });

  it('propagates an invalid input as ZodError without a degraded result or ledger record', async () => {
    const task = { ...classifySkillsTask, degrade: () => ({ skills: [] }) };
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([provider]);

    await expect(
      runTask.execute(task, { text: 42 } as unknown as typeof INPUT, CONSENT),
    ).rejects.toBeInstanceOf(ZodError);
    expect(deps.ledger.records).toEqual([]);
  });

  it('propagates InvalidDegradeOutput instead of returning degraded', async () => {
    const task = {
      ...classifySkillsTask,
      degrade: () => ({ skills: 'not an array' }) as never,
    };
    const { runTask } = harness([]);

    const error = await runTask
      .execute(task, INPUT, CONSENT)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidDegradeOutput);
    expect(error).toMatchObject({ taskName: 'classify-skills' });
  });
});

describe('RunTask: result cache', () => {
  /**
   * Variante pública y cacheable de classify-skills: la tarea real es `personal` y no cacheable; estos
   * escenarios prueban la caché de resultados de tareas `public` (como `extract-job`).
   */
  const cacheableTask: AiTask<{ text: string }, ClassifySkillsOutput> = {
    ...classifySkillsTask,
    dataSensitivity: 'public',
    cacheable: true,
  };

  /** Variante de classify-skills con dos claves de input para probar el orden de claves. */
  const twoKeyTask: AiTask<
    { text: string; source: string },
    ClassifySkillsOutput
  > = {
    ...cacheableTask,
    inputSchema: z.object({ text: z.string().min(1), source: z.string() }),
  };

  it('Segunda ejecución idéntica', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID], { model: 'qwen' });
    const { runTask, deps } = harness([provider]);

    const first = await runTask.execute(
      twoKeyTask,
      { text: INPUT.text, source: 'cv' },
      CONSENT,
    );
    const second = await runTask.execute(
      twoKeyTask,
      { source: 'cv', text: INPUT.text },
      CONSENT,
    );

    expect(first).toMatchObject({ status: 'success', cached: false });
    expect(second).toEqual({
      status: 'success',
      output: VALID_OUTPUT,
      providerId: 'ollama',
      model: 'qwen',
      promptVersion: 'v1',
      cached: true,
    });
    expect(provider.calls).toBe(1);
    expect(deps.ledger.records.map((r) => r.outcome)).toEqual(['success']);
  });

  it('Caché compartida entre procesos', async () => {
    const sharedCache = new InMemoryResultCache();
    const firstProvider = new FakeLlmProvider('ollama', [VALID]);
    const secondProvider = new FakeLlmProvider('ollama', [VALID]);
    const first = harness([firstProvider], { cache: sharedCache });
    const second = harness([secondProvider], { cache: sharedCache });

    await first.runTask.execute(cacheableTask, INPUT, CONSENT);
    const result = await second.runTask.execute(cacheableTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success', cached: true });
    expect(secondProvider.calls).toBe(0);
  });

  it('stores only output, provider, model and prompt version', async () => {
    const { runTask, deps } = harness([
      new FakeLlmProvider('ollama', [VALID], { model: 'qwen' }),
    ]);

    await runTask.execute(cacheableTask, INPUT, CONSENT);

    expect([...deps.cache.entries.values()]).toEqual([
      {
        output: VALID_OUTPUT,
        providerId: 'ollama',
        model: 'qwen',
        promptVersion: 'v1',
      },
    ]);
  });

  it('Nueva versión de prompt', async () => {
    const cache = new InMemoryResultCache();
    const v1 = harness([new FakeLlmProvider('ollama', [VALID])], { cache });
    await v1.runTask.execute(cacheableTask, INPUT, CONSENT);
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const v2 = harness([provider], { cache });

    const result = await v2.runTask.execute(
      { ...cacheableTask, promptVersion: 'v2' },
      INPUT,
      CONSENT,
    );

    expect(result).toMatchObject({
      status: 'success',
      cached: false,
      promptVersion: 'v2',
    });
    expect(provider.calls).toBe(1);
  });

  it('Mismo input en otro idioma', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider]);

    await runTask.execute(cacheableTask, INPUT, {
      ...CONSENT,
      outputLanguage: 'es',
    });
    const result = await runTask.execute(cacheableTask, INPUT, {
      ...CONSENT,
      outputLanguage: 'en',
    });

    expect(result).toMatchObject({ status: 'success', cached: false });
    expect(provider.calls).toBe(2);
  });

  it('Cadena con mock', async () => {
    const mock = new FakeLlmProvider('mock', [VALID]);
    const { runTask, deps } = harness([
      mock,
      new FakeLlmProvider('ollama', [VALID]),
    ]);

    await runTask.execute(cacheableTask, INPUT, CONSENT);
    await runTask.execute(cacheableTask, INPUT, CONSENT);

    expect(deps.cache.gets).toBe(0);
    expect(deps.cache.sets).toBe(0);
  });

  it('Almacén de caché caído', async () => {
    const cache = new InMemoryResultCache();
    cache.failing = true;
    const { runTask, deps } = harness(
      [new FakeLlmProvider('ollama', [VALID])],
      { cache },
    );

    const result = await runTask.execute(cacheableTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success', cached: false });
    expect(cache.gets).toBe(1);
    expect(cache.sets).toBe(1);
    expect(deps.logger.warnings.map((w) => w.message)).toEqual([
      'AI result cache read failed',
      'AI result cache write failed',
    ]);
  });

  it('never stores a degraded result', async () => {
    const { runTask, deps } = harness([
      new FakeLlmProvider('ollama', [new Error('down')]),
    ]);

    await runTask.execute(
      { ...cacheableTask, degrade: () => ({ skills: [] }) },
      INPUT,
      CONSENT,
    );

    expect(deps.cache.sets).toBe(0);
  });

  it('ignores a cached entry whose output no longer matches the schema', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([provider]);
    const key = executionKey({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: INPUT,
    });
    deps.cache.entries.set(key, {
      output: { skills: 'broken' },
      providerId: 'ollama',
      model: 'old',
      promptVersion: 'v1',
    });

    const result = await runTask.execute(cacheableTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success', cached: false });
    expect(provider.calls).toBe(1);
  });

  it('Dos ejecuciones idénticas de una tarea personal', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID, VALID]);
    const { runTask, deps } = harness([provider]);

    const first = await runTask.execute(classifySkillsTask, INPUT, CONSENT);
    const second = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(first).toMatchObject({ status: 'success', cached: false });
    expect(second).toMatchObject({ status: 'success', cached: false });
    expect(provider.calls).toBe(2);
    expect(deps.cache.gets).toBe(0);
    expect(deps.cache.sets).toBe(0);
  });

  it('Una tarea personal nunca se devuelve cacheada', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([provider]);
    // Entrada preexistente: aunque hubiera algo en el almacén, no se lee.
    const key = executionKey({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: INPUT,
    });
    deps.cache.entries.set(key, {
      output: VALID_OUTPUT,
      providerId: 'ollama',
      model: 'cached-model',
      promptVersion: 'v1',
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success', cached: false });
    expect(provider.calls).toBe(1);
    expect(deps.cache.gets).toBe(0);
  });
});

describe('RunTask: data protection', () => {
  const PERSONAL_INPUT = {
    text: 'Ana Pérez, ana@example.com, +591 71234567. TypeScript desde 2019-2023.',
  };

  it('Proveedor externo', async () => {
    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([external]);

    await runTask.execute(classifySkillsTask, PERSONAL_INPUT, CONSENT);

    const sent = external.requests[0]?.user ?? '';
    expect(sent).toContain('[EMAIL_1]');
    expect(sent).toContain('[PHONE_1]');
    expect(sent).not.toContain('ana@example.com');
    expect(sent).not.toContain('71234567');
    expect(sent).toContain('2019-2023');
    // El nombre no se redacta sin redactName.
    expect(sent).toContain('Ana Pérez');
  });

  it('keeps the execution key of the unredacted input', async () => {
    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([external]);

    await runTask.execute(classifySkillsTask, PERSONAL_INPUT, CONSENT);

    expect(external.requests[0]?.trace?.key).toBe(
      executionKey({
        taskName: 'classify-skills',
        promptVersion: 'v1',
        outputLanguage: 'es',
        input: PERSONAL_INPUT,
      }),
    );
  });

  it('redacts the person name when the context asks for it', async () => {
    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([external]);

    await runTask.execute(classifySkillsTask, PERSONAL_INPUT, {
      ...CONSENT,
      redactName: true,
      personName: 'Ana Pérez',
    });

    const sent = external.requests[0]?.user ?? '';
    expect(sent).toContain('[NAME_1]');
    expect(sent).not.toContain('Ana Pérez');
  });

  it('Proveedor local', async () => {
    const local = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([local]);

    await runTask.execute(classifySkillsTask, PERSONAL_INPUT, {
      ...CONSENT,
      redactName: true,
      personName: 'Ana Pérez',
    });

    expect(local.requests[0]?.user).toBe(JSON.stringify(PERSONAL_INPUT));
  });

  it('Tarea pública hacia proveedor externo', async () => {
    const external = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([external]);
    const input = {
      text: 'Oferta en https://jobs.example.com/123 con TypeScript',
    };

    await runTask.execute(
      { ...classifySkillsTask, dataSensitivity: 'public' },
      input,
      { aiConsent: { externalProviders: false } },
    );

    expect(external.requests[0]?.user).toContain(
      'https://jobs.example.com/123',
    );
  });

  it('Marcador en la salida', async () => {
    const external = new FakeLlmProvider(
      'openrouter',
      ['{"skills":[{"name":"[EMAIL_1]","category":"other"}]}'],
      { capabilities: { external: true } },
    );
    const { runTask, deps } = harness([external]);

    const result = await runTask.execute(
      classifySkillsTask,
      PERSONAL_INPUT,
      CONSENT,
    );

    expect(result).toMatchObject({
      status: 'success',
      output: { skills: [{ name: 'ana@example.com', category: 'other' }] },
      cached: false,
    });
    expect(JSON.stringify(result)).not.toContain('[EMAIL_1]');
    // Una tarea personal no escribe la salida reinyectada en la caché compartida.
    expect(deps.cache.sets).toBe(0);
    expect(deps.cache.entries.size).toBe(0);
  });

  it('deferPiiReinjection: output keeps markers and reinjectedOutput restores values', async () => {
    const external = new FakeLlmProvider(
      'openrouter',
      ['{"skills":[{"name":"[EMAIL_1]","category":"other"}]}'],
      { capabilities: { external: true } },
    );
    const { runTask } = harness([external]);

    const result = await runTask.execute(classifySkillsTask, PERSONAL_INPUT, {
      ...CONSENT,
      deferPiiReinjection: true,
    });

    expect(result).toMatchObject({
      status: 'success',
      output: { skills: [{ name: '[EMAIL_1]', category: 'other' }] },
      reinjectedOutput: {
        skills: [{ name: 'ana@example.com', category: 'other' }],
      },
      cached: false,
    });
    if (result.status !== 'success') throw new Error('expected success');
    expect(JSON.stringify(result.output)).not.toContain('ana@example.com');
  });

  it('Marcador inventado por el proveedor', async () => {
    const invented = '{"skills":[{"name":"[ADDRESS_3]","category":"other"}]}';
    const fixed = '{"skills":[{"name":"TypeScript","category":"language"}]}';
    const external = new FakeLlmProvider('openrouter', [invented, fixed], {
      capabilities: { external: true },
    });
    const { runTask } = harness([external]);

    const result = await runTask.execute(
      classifySkillsTask,
      PERSONAL_INPUT,
      CONSENT,
    );

    expect(result).toMatchObject({
      status: 'success',
      output: { skills: [{ name: 'TypeScript', category: 'language' }] },
    });
    expect(external.calls).toBe(2);
    expect(JSON.stringify(result)).not.toContain('[ADDRESS_3]');
  });

  it('El proveedor insiste con el marcador inventado', async () => {
    const invented = '{"skills":[{"name":"[ADDRESS_3]","category":"other"}]}';
    const first = new FakeLlmProvider('openrouter', [invented, invented], {
      capabilities: { external: true, costPer1kOut: 0 },
    });
    const second = new FakeLlmProvider(
      'openrouter-b',
      ['{"skills":[{"name":"TypeScript","category":"language"}]}'],
      { capabilities: { external: true, costPer1kOut: 0.01 } },
    );
    const { runTask } = harness([first, second]);

    const result = await runTask.execute(
      classifySkillsTask,
      PERSONAL_INPUT,
      CONSENT,
    );

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'openrouter-b',
    });
    expect(first.calls).toBe(2);
    expect(second.calls).toBe(1);
    expect(JSON.stringify(result)).not.toContain('[ADDRESS_3]');
  });

  it('Un marcador inventado nunca llega al usuario ni al disco', async () => {
    const invented = '{"skills":[{"name":"[ADDRESS_3]","category":"other"}]}';
    const external = new FakeLlmProvider('openrouter', [invented, invented], {
      capabilities: { external: true },
    });
    const { runTask, deps } = harness([external]);

    const result = await runTask.execute(
      classifySkillsTask,
      PERSONAL_INPUT,
      CONSENT,
    );

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(JSON.stringify(result)).not.toContain('[ADDRESS_3]');
    expect(deps.cache.sets).toBe(0);
    expect(
      deps.ledger.records.every(
        (record) => !JSON.stringify(record).includes('[ADDRESS_3]'),
      ),
    ).toBe(true);
  });

  it('redacts per provider: the local fallback receives the original input', async () => {
    const external = new FakeLlmProvider('openrouter', [new Error('429')], {
      capabilities: { external: true, costPer1kOut: 0 },
    });
    // El local cuesta más, así que la política pone primero al externo gratuito.
    const local = new FakeLlmProvider('ollama', [VALID], {
      capabilities: { costPer1kOut: 0.1 },
    });
    const { runTask } = harness([local, external]);

    const result = await runTask.execute(
      classifySkillsTask,
      PERSONAL_INPUT,
      CONSENT,
    );

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
    expect(external.requests[0]?.user).not.toContain('ana@example.com');
    expect(local.requests[0]?.user).toBe(JSON.stringify(PERSONAL_INPUT));
  });
});

describe('RunTask: usage ledger', () => {
  const USER_CTX: RunContext = { ...CONSENT, userId: 'user-1' };

  it('Ejecución exitosa', async () => {
    const clock = new ManualClock();
    const provider = new FakeLlmProvider(
      'openrouter',
      [
        () => {
          clock.advance(250);
          return Promise.resolve(VALID);
        },
      ],
      {
        model: 'paid-model',
        usage: { inputTokens: 2_000, outputTokens: 500 },
        capabilities: { costPer1kIn: 0.5, costPer1kOut: 2 },
      },
    );
    const { runTask, deps } = harness([provider], { clock });

    await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(deps.ledger.records).toEqual([
      {
        userId: 'user-1',
        task: 'classify-skills',
        providerId: 'openrouter',
        model: 'paid-model',
        inputTokens: 2_000,
        outputTokens: 500,
        estCost: 2,
        latencyMs: 250,
        outcome: 'success',
        promptVersion: 'v1',
        key: executionKey({
          taskName: 'classify-skills',
          promptVersion: 'v1',
          outputLanguage: 'es',
          input: INPUT,
        }),
        at: new Date(clock.now()),
      },
    ]);
  });

  it('sums the tokens of the original and the repair request in one record', async () => {
    const provider = new FakeLlmProvider('ollama', [INVALID, VALID], {
      usage: { inputTokens: 100, outputTokens: 10 },
    });
    const { runTask, deps } = harness([provider]);

    await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(deps.ledger.records).toHaveLength(1);
    expect(deps.ledger.records[0]).toMatchObject({
      outcome: 'success',
      inputTokens: 200,
      outputTokens: 20,
    });
    expect(deps.ledger.records[0]).not.toHaveProperty('userId');
  });

  it('Fallo seguido de éxito', async () => {
    const { runTask, deps } = harness([
      new FakeLlmProvider('ollama', [new Error('ECONNRESET')]),
      new FakeLlmProvider('mock', [VALID]),
    ]);

    await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(
      deps.ledger.records.map((r) => [r.outcome, r.providerId, r.model]),
    ).toEqual([
      ['provider_error', 'ollama', null],
      ['success', 'mock', 'mock-model'],
    ]);
  });

  it('Resultado degradado', async () => {
    const { runTask, deps } = harness([
      new FakeLlmProvider('ollama', [new Error('down')]),
    ]);

    await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(deps.ledger.records.map((r) => r.outcome)).toEqual([
      'provider_error',
      'degraded',
    ]);
    expect(deps.ledger.records[1]).toMatchObject({
      userId: 'user-1',
      outcome: 'degraded',
      reason: 'providers_failed',
      providerId: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estCost: 0,
      latencyMs: 0,
    });
  });

  it('Proveedor gratuito', async () => {
    const { runTask, deps } = harness([
      new FakeLlmProvider('ollama', [VALID], {
        usage: { inputTokens: 5_000, outputTokens: 900 },
      }),
    ]);

    await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(deps.ledger.records[0]).toMatchObject({
      outcome: 'success',
      estCost: 0,
    });
  });

  it('records nothing for a cache hit', async () => {
    const cacheableTask = {
      ...classifySkillsTask,
      dataSensitivity: 'public' as const,
      cacheable: true,
    };
    const { runTask, deps } = harness([new FakeLlmProvider('ollama', [VALID])]);

    await runTask.execute(cacheableTask, INPUT, CONSENT);
    await runTask.execute(cacheableTask, INPUT, CONSENT);

    expect(deps.ledger.records).toHaveLength(1);
  });

  it('Input con datos personales', async () => {
    const input = { text: 'Contacto ana@example.com, TypeScript' };
    const { runTask, deps } = harness([
      new FakeLlmProvider('ollama', [new Error('down')]),
      new FakeLlmProvider('mock', [VALID]),
    ]);

    await runTask.execute(classifySkillsTask, input, CONSENT);

    const stored = JSON.stringify(deps.ledger.records);
    expect(stored).not.toContain('ana@example.com');
    expect(stored).not.toContain('TypeScript');
  });

  it('does not wait for a ledger that never resolves', async () => {
    const { runTask } = harness([new FakeLlmProvider('ollama', [VALID])], {
      ledger: new InMemoryUsageLedger('never-resolves'),
    });

    const outcome = await Promise.race([
      runTask.execute(classifySkillsTask, INPUT, CONSENT),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 200),
      ),
    ]);

    expect(outcome).toMatchObject({ status: 'success' });
  });

  it('logs a ledger failure as a warning without failing the task', async () => {
    const ledger = new InMemoryUsageLedger('rejects');
    const { runTask, deps } = harness(
      [new FakeLlmProvider('ollama', [VALID])],
      {
        ledger,
      },
    );

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);
    await vi.waitFor(() => {
      expect(deps.logger.warnings.map((w) => w.message)).toContain(
        'AI usage ledger write failed',
      );
    });

    expect(result).toMatchObject({ status: 'success' });
  });

  it('logs a ledger that throws synchronously without failing the task', async () => {
    const ledger = new InMemoryUsageLedger();
    ledger.record = () => {
      throw new Error('sync failure');
    };
    const { runTask, deps } = harness(
      [new FakeLlmProvider('ollama', [VALID])],
      {
        ledger,
      },
    );

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success' });
    expect(deps.logger.warnings.map((w) => w.message)).toContain(
      'AI usage ledger write failed',
    );
  });
});

describe('RunTask: quotas', () => {
  const USER_CTX: RunContext = { ...CONSENT, userId: 'user-1' };

  /** Política en memoria con un límite diario por tarea contado sobre los `success` del ledger en 24 h. */
  function limitPolicy(
    ledger: InMemoryUsageLedger,
    clock: ManualClock,
    limits: Partial<Record<string, number>>,
  ): InMemoryQuotaPolicy {
    return new InMemoryQuotaPolicy((userId, task) => {
      const limit = limits[task];
      if (limit === undefined) return Promise.resolve({ allowed: true });
      const since = clock.now() - 24 * 60 * 60 * 1000;
      const successes = ledger.records.filter(
        (r) =>
          r.userId === userId &&
          r.task === task &&
          r.outcome === 'success' &&
          r.at.getTime() >= since &&
          !(
            typeof r.providerId === 'string' && r.providerId.startsWith('byok:')
          ),
      );
      if (successes.length < limit) return Promise.resolve({ allowed: true });
      const oldest = Math.min(...successes.map((r) => r.at.getTime()));
      return Promise.resolve({
        allowed: false,
        retryAt: new Date(oldest + 24 * 60 * 60 * 1000),
      });
    });
  }

  it('Límite alcanzado', async () => {
    const ledger = new InMemoryUsageLedger();
    const clock = new ManualClock();
    const quota = limitPolicy(ledger, clock, { 'classify-skills': 2 });
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider], { ledger, clock, quota });
    await runTask.execute(classifySkillsTask, { text: 'TypeScript' }, USER_CTX);
    await runTask.execute(classifySkillsTask, { text: 'NestJS' }, USER_CTX);
    const recordsBefore = ledger.records.length;

    const result = await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(result).toMatchObject({
      status: 'degraded',
      reason: 'quota_exceeded',
      aiQuotaRetryAt: expect.any(String),
    });
    expect(provider.calls).toBe(2);
    const newRecords = ledger.records.slice(recordsBefore);
    expect(newRecords).toHaveLength(1);
    expect(newRecords[0]).toMatchObject({
      userId: 'user-1',
      outcome: 'quota',
      providerId: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estCost: 0,
      latencyMs: 0,
    });
    expect(newRecords[0]).not.toHaveProperty('reason');
  });

  it('La cuota agotada dice cuándo volver', async () => {
    const oldestAt = Date.parse('2026-09-17T08:00:00.000Z');
    const clock = new ManualClock(Date.parse('2026-09-17T10:00:00.000Z'));
    const retryAt = new Date(oldestAt + 24 * 60 * 60 * 1000);
    const quota = new InMemoryQuotaPolicy(() =>
      Promise.resolve({ allowed: false, retryAt }),
    );
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider], { quota, clock });

    const result = await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'quota_exceeded',
      aiQuotaRetryAt: retryAt.toISOString(),
    });
    expect(provider.calls).toBe(0);
  });

  it('includes the validated degrade output when the quota is exceeded', async () => {
    const quota = new InMemoryQuotaPolicy(() =>
      Promise.resolve({
        allowed: false,
        retryAt: new Date('2026-09-18T10:00:00.000Z'),
      }),
    );
    const { runTask } = harness([new FakeLlmProvider('ollama', [VALID])], {
      quota,
    });

    const result = await runTask.execute(
      { ...classifySkillsTask, degrade: () => ({ skills: [] }) },
      INPUT,
      USER_CTX,
    );

    expect(result).toEqual({
      status: 'degraded',
      reason: 'quota_exceeded',
      output: { skills: [] },
      aiQuotaRetryAt: '2026-09-18T10:00:00.000Z',
    });
  });

  it('Ejecución sin usuario', async () => {
    const quota = new InMemoryQuotaPolicy(() =>
      Promise.resolve({
        allowed: false,
        retryAt: new Date('2026-09-18T10:00:00.000Z'),
      }),
    );
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider], { quota });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success' });
    expect(quota.calls).toEqual([]);
  });

  it('asks the policy once per execution with the user and the task', async () => {
    const quota = new InMemoryQuotaPolicy();
    const { runTask } = harness(
      [
        new FakeLlmProvider('ollama', [new Error('down')]),
        new FakeLlmProvider('mock', [VALID]),
      ],
      { quota },
    );

    await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(quota.calls).toEqual([
      { userId: 'user-1', task: 'classify-skills' },
    ]);
  });

  it('Conteo no disponible', async () => {
    const quota = new InMemoryQuotaPolicy(() =>
      Promise.reject(new Error('mongo down')),
    );
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([provider], { quota });

    const result = await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(result).toMatchObject({ status: 'success' });
    expect(provider.calls).toBe(1);
    expect(deps.logger.warnings.map((w) => w.message)).toContain(
      'AI quota check failed, allowing execution',
    );
  });
});

describe('RunTask: BYOK routing and platform quota', () => {
  const USER_CTX: RunContext = { ...CONSENT, userId: 'ana' };

  function stubByok(providers: readonly LlmProvider[]) {
    return {
      providersFor: (userId: string | undefined) =>
        Promise.resolve(userId === 'ana' ? [...providers] : []),
    };
  }

  it('prefers BYOK over platform when both are eligible', async () => {
    const byok = new FakeLlmProvider('byok:ana:openai', [VALID], {
      capabilities: { external: true },
    });
    const platform = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([platform], {
      byokFactory: stubByok([byok]),
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'byok:ana:openai',
    });
    expect(byok.calls).toBe(1);
    expect(platform.calls).toBe(0);
  });

  it('does not inject another user BYOK into Ana chain', async () => {
    const beto = new FakeLlmProvider('byok:beto:openai', [VALID], {
      capabilities: { external: true },
    });
    const platform = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([platform], {
      byokFactory: {
        providersFor: (userId) =>
          Promise.resolve(userId === 'beto' ? [beto] : []),
      },
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
    expect(beto.calls).toBe(0);
  });

  it('with platform quota exhausted uses only BYOK', async () => {
    const byok = new FakeLlmProvider('byok:ana:openai', [VALID], {
      capabilities: { external: true },
    });
    const platform = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const quota = new InMemoryQuotaPolicy(() =>
      Promise.resolve({
        allowed: false,
        retryAt: new Date('2026-09-18T10:00:00.000Z'),
      }),
    );
    const { runTask } = harness([platform], {
      byokFactory: stubByok([byok]),
      quota,
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, USER_CTX);

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'byok:ana:openai',
    });
    expect(platform.calls).toBe(0);
  });

  it('degrades quota_exceeded when platform quota is exhausted without BYOK', async () => {
    const platform = new FakeLlmProvider('ollama', [VALID]);
    const quota = new InMemoryQuotaPolicy(() =>
      Promise.resolve({
        allowed: false,
        retryAt: new Date('2026-09-18T10:00:00.000Z'),
      }),
    );
    const { runTask } = harness([platform], { quota });

    await expect(
      runTask.execute(classifySkillsTask, INPUT, USER_CTX),
    ).resolves.toMatchObject({
      status: 'degraded',
      reason: 'quota_exceeded',
    });
    expect(platform.calls).toBe(0);
  });

  it('does not use BYOK without consent on a personal task', async () => {
    const byok = new FakeLlmProvider('byok:ana:openai', [VALID], {
      capabilities: { external: true },
    });
    const platform = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([platform], {
      byokFactory: stubByok([byok]),
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      userId: 'ana',
      aiConsent: { externalProviders: false },
    });

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
    expect(byok.calls).toBe(0);
  });
});

describe('RunTask: circuit breaker integration', () => {
  it('Apertura tras fallos repetidos', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    const failing = new FakeLlmProvider('ollama', [new Error('ECONNREFUSED')]);
    const healthy = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = harness([failing, healthy], { clock, breaker });

    for (let run = 0; run < 5; run++) {
      clock.advance(1_000);
      await runTask.execute(
        classifySkillsTask,
        { text: `TypeScript ${run}` },
        CONSENT,
      );
    }
    expect(failing.calls).toBe(5);

    clock.advance(1_000);
    const result = await runTask.execute(
      classifySkillsTask,
      { text: 'TypeScript final' },
      CONSENT,
    );

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'openrouter',
    });
    expect(failing.calls).toBe(5);
  });

  it('counts a schema_error as availability and a provider_error as a failure', async () => {
    const { runTask, deps } = harness([
      new FakeLlmProvider('ollama', [INVALID, INVALID]),
      new FakeLlmProvider('mock', [new Error('down')]),
      new FakeLlmProvider('zeta', [VALID]),
    ]);

    await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(deps.breaker.acquired).toEqual(['ollama', 'mock', 'zeta']);
    expect(deps.breaker.successes).toEqual(['ollama', 'zeta']);
    expect(deps.breaker.failures).toEqual(['mock']);
  });

  it('Recuperación en half-open', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    for (let i = 0; i < 5; i++) await breaker.recordFailure('ollama');
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider], { clock, breaker });

    await expect(
      runTask.execute(classifySkillsTask, INPUT, CONSENT),
    ).resolves.toMatchObject({ status: 'degraded', reason: 'no_providers' });
    clock.advance(30_000);
    const result = await runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      outputLanguage: 'en',
    });

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
    expect((await breaker.openIds()).size).toBe(0);
  });

  it('Permiso de prueba no usado', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    for (let i = 0; i < 5; i++) await breaker.recordFailure('openrouter');
    clock.advance(30_000);
    const local = new FakeLlmProvider('ollama', [VALID]);
    const halfOpen = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const first = harness([halfOpen, local], { clock, breaker });

    // El local resuelve primero: el proveedor en half-open no llega a tomar el permiso.
    await first.runTask.execute(classifySkillsTask, INPUT, CONSENT);
    expect(halfOpen.calls).toBe(0);

    const second = harness([halfOpen], { clock, breaker });
    const result = await second.runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      outputLanguage: 'en',
    });

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'openrouter',
    });
  });

  it('skips a provider without a breaker permit and reports no_providers when none was contacted', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    for (let i = 0; i < 5; i++) await breaker.recordFailure('ollama');
    clock.advance(30_000);
    // Otro proceso lógico ya tomó el permiso de prueba.
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([provider], { clock, breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'no_providers',
      providerCondition: { kind: 'unavailable' },
    });
    expect(provider.calls).toBe(0);
    expect(deps.ledger.records.map((r) => r.outcome)).toEqual(['degraded']);
  });
});

describe('RunTask: deadlines and cancellation (real timers)', () => {
  const neverResolves = () => new Promise<string>(() => undefined);

  it('Proveedor que no responde', async () => {
    const stuck = new FakeLlmProvider('ollama', [neverResolves]);
    const healthy = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask, deps } = harness([stuck, healthy], {
      providerTimeoutsMs: { ollama: 30, openrouter: 1_000 },
    });

    const startedAt = Date.now();
    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result).toMatchObject({
      status: 'success',
      providerId: 'openrouter',
    });
    expect(deps.ledger.records.map((r) => [r.providerId, r.outcome])).toEqual([
      ['ollama', 'provider_error'],
      ['openrouter', 'success'],
    ]);
    expect(deps.breaker.failures).toEqual(['ollama']);
    expect(deps.logger.warnings[0]?.fields).toMatchObject({
      providerId: 'ollama',
      error: 'TimeoutError',
    });
  });

  it('runs without ctx.signal and passes a combined signal in req.signal', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider], {
      providerTimeoutsMs: { ollama: 50 },
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success' });
    const signal = provider.requests[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('delivers req.signal aborted to a provider that times out', async () => {
    const stuck = new FakeLlmProvider('ollama', [neverResolves]);
    const { runTask } = harness([stuck], {
      providerTimeoutsMs: { ollama: 20 },
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(stuck.requests[0]?.signal?.aborted).toBe(true);
  });

  it('applies the timeout to the repair request too', async () => {
    const provider = new FakeLlmProvider('ollama', [INVALID, neverResolves]);
    const { runTask, deps } = harness([provider], {
      providerTimeoutsMs: { ollama: 30 },
    });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(provider.calls).toBe(2);
    expect(deps.ledger.records[0]).toMatchObject({
      outcome: 'provider_error',
      inputTokens: 100,
    });
  });

  it('Cancelación del llamador', async () => {
    const controller = new AbortController();
    const stuck = new FakeLlmProvider('ollama', [neverResolves]);
    const next = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask, deps } = harness([stuck, next], {
      providerTimeoutsMs: { ollama: 5_000, openrouter: 5_000 },
    });
    setTimeout(() => controller.abort(), 20);

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      signal: controller.signal,
    });

    // El proveedor cancelado cuenta como `unavailable`; el siguiente no se intentó y no cuenta.
    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(stuck.requests[0]?.signal?.aborted).toBe(true);
    expect(next.calls).toBe(0);
    expect(deps.breaker.failures).toEqual([]);
    expect(deps.breaker.released).toEqual(['ollama']);
    expect(deps.ledger.records.map((r) => [r.outcome, r.reason])).toEqual([
      ['degraded', 'providers_failed'],
    ]);
    expect(deps.logger.warnings).toEqual([]);
  });

  it('returns the half-open permit of a cancelled probe to a real breaker', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    for (let i = 0; i < 5; i++) await breaker.recordFailure('ollama');
    clock.advance(30_000);
    const controller = new AbortController();
    const provider = new FakeLlmProvider('ollama', [neverResolves, VALID]);
    const { runTask } = harness([provider], { clock, breaker });
    setTimeout(() => controller.abort(), 20);

    await runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      signal: controller.signal,
    });
    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({ status: 'success', providerId: 'ollama' });
  });

  it('degrades without contacting providers when ctx.signal is already aborted', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask, deps } = harness([provider]);

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      signal: AbortSignal.abort(),
    });

    expect(result).toEqual({ status: 'degraded', reason: 'providers_failed' });
    expect(provider.calls).toBe(0);
    expect(deps.breaker.acquired).toEqual([]);
  });
});

/**
 * Breaker guionado: su instantánea de circuitos abiertos y los permisos de `tryAcquire` se fijan aparte, de modo que
 * cambian de estado entre `openIds()` y `tryAcquire()` (N3). Cuenta las lecturas de clases recordadas (P1-4).
 */
class ScriptedBreaker implements CircuitBreaker {
  openConditionsCalls = 0;
  readonly failures: { id: string; kind: ProviderFailure['kind'] }[] = [];
  onFailure: (() => void) | undefined;

  constructor(
    private readonly script: {
      open?: readonly string[];
      denied?: readonly string[];
      conditions?: Readonly<Record<string, ProviderFailure['kind']>>;
    } = {},
  ) {}

  openIds(): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(this.script.open ?? []));
  }

  snapshotOpenIds(): Promise<ReadonlySet<string> | null> {
    return this.openIds();
  }

  tryAcquire(providerId: string): Promise<boolean> {
    return Promise.resolve(!(this.script.denied ?? []).includes(providerId));
  }

  recordSuccess(): Promise<void> {
    return Promise.resolve();
  }

  recordFailure(
    providerId: string,
    failure: ProviderFailure = { kind: 'unavailable' },
  ): Promise<void> {
    this.failures.push({ id: providerId, kind: failure.kind });
    this.onFailure?.();
    return Promise.resolve();
  }

  release(): Promise<void> {
    return Promise.resolve();
  }

  openConditions(): Promise<ReadonlyMap<string, ProviderFailure>> {
    this.openConditionsCalls++;
    return Promise.resolve(
      new Map(
        Object.entries(this.script.conditions ?? {}).map(([id, kind]) => [
          id,
          { kind },
        ]),
      ),
    );
  }
}

const EXTERNAL = { capabilities: { external: true } };

describe('RunTask: failure class in the breaker (paste-fallback-honest 2.5b)', () => {
  it('a 429 records a rate_limited failure in the breaker', async () => {
    const provider = new FakeLlmProvider('ollama', [
      new ProviderUnavailable('ollama', 429),
    ]);
    const { runTask, deps } = harness([provider]);

    await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(deps.breaker.failures).toEqual(['ollama']);
    expect(deps.breaker.failureKinds).toEqual([{ kind: 'rate_limited' }]);
  });

  it('a non-provider error is recorded as unavailable', async () => {
    const provider = new FakeLlmProvider('ollama', [new Error('boom')]);
    const { runTask, deps } = harness([provider]);

    await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(deps.breaker.failureKinds).toEqual([{ kind: 'unavailable' }]);
  });

  it('a provider eligible in the snapshot but skipped by tryAcquire is an affected unavailable', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const breaker = new ScriptedBreaker({ denied: ['ollama'] });
    const { runTask } = harness([provider], { breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'no_providers',
      providerCondition: { kind: 'unavailable' },
    });
    expect(provider.calls).toBe(0);
  });

  it('a schema error counts as unavailable', async () => {
    const provider = new FakeLlmProvider('ollama', [INVALID, INVALID]);
    const { runTask, deps } = harness([provider]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(deps.breaker.failures).toEqual([]);
  });
});

describe('RunTask: provider condition (paste-fallback-honest 2.5c-i)', () => {
  it('single provider 429 degrades providers_failed with rate_limited', async () => {
    const provider = new FakeLlmProvider(
      'openrouter',
      [new ProviderUnavailable('openrouter', 429)],
      EXTERNAL,
    );
    const { runTask } = harness([provider]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'rate_limited' },
    });
  });

  it('next run with the circuit open degrades no_providers with rate_limited and no request', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    const provider = new FakeLlmProvider(
      'openrouter',
      [new ProviderUnavailable('openrouter', 429)],
      EXTERNAL,
    );
    const { runTask } = harness([provider], { clock, breaker });
    for (let i = 0; i < 5; i++) {
      await runTask.execute(classifySkillsTask, INPUT, CONSENT);
    }
    expect(provider.calls).toBe(5);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'no_providers',
      providerCondition: { kind: 'rate_limited' },
    });
    expect(provider.calls).toBe(5);
  });

  it('404 gives a rejected condition', async () => {
    const provider = new FakeLlmProvider(
      'openrouter',
      [new ProviderUnavailable('openrouter', 404)],
      EXTERNAL,
    );
    const { runTask } = harness([provider]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({
      reason: 'providers_failed',
      providerCondition: { kind: 'rejected' },
    });
  });

  it('503 plus 429 aggregates to unavailable', async () => {
    const local = new FakeLlmProvider('ollama', [
      new ProviderUnavailable('ollama', 503),
    ]);
    const external = new FakeLlmProvider(
      'openrouter',
      [new ProviderUnavailable('openrouter', 429)],
      EXTERNAL,
    );
    const { runTask } = harness([local, external]);

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(local.calls).toBe(1);
    expect(external.calls).toBe(1);
    expect(result).toMatchObject({
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
  });

  it('the hypothetical chain keeps excludeProviderIds', async () => {
    const excluded = new FakeLlmProvider('ollama', [VALID]);
    const limited = new FakeLlmProvider(
      'openrouter',
      [new ProviderUnavailable('openrouter', 429)],
      EXTERNAL,
    );
    // `ollama` tiene el circuito abierto con clase `unavailable`; está excluido de la ejecución.
    const breaker = new ScriptedBreaker({
      open: ['ollama'],
      conditions: { ollama: 'unavailable' },
    });
    const { runTask } = harness([excluded, limited], { breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      excludeProviderIds: ['ollama'],
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'rate_limited' },
    });
  });

  it('providers not attempted after a cancellation do not count', async () => {
    const controller = new AbortController();
    const first = new FakeLlmProvider('ollama', [
      new ProviderUnavailable('ollama', 429),
    ]);
    const second = new FakeLlmProvider('openrouter', [VALID], EXTERNAL);
    const breaker = new ScriptedBreaker();
    // La cancelación llega justo después de registrar el fallo del primero y antes de intentar el segundo.
    breaker.onFailure = () => controller.abort();
    const { runTask } = harness([first, second], { breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      signal: controller.signal,
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'rate_limited' },
    });
    expect(second.calls).toBe(0);
  });

  it('a cancellation before the first attempt gives no condition', async () => {
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider]);

    const result = await runTask.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      signal: AbortSignal.abort(),
    });

    expect(result).toEqual({ status: 'degraded', reason: 'providers_failed' });
  });

  it('success path never calls openConditions', async () => {
    const first = new FakeLlmProvider('ollama', [
      new ProviderUnavailable('ollama', 429),
    ]);
    const second = new FakeLlmProvider('openrouter', [VALID], EXTERNAL);
    const breaker = new ScriptedBreaker({
      open: ['other'],
      conditions: { other: 'rejected' },
    });
    const { runTask } = harness([first, second], { breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'openrouter',
    });
    expect(breaker.openConditionsCalls).toBe(0);
  });

  it('AI_CHAIN none gives no_providers without condition', async () => {
    const breaker = new ScriptedBreaker();
    const { runTask } = harness([], { breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({ status: 'degraded', reason: 'no_providers' });
    expect(breaker.openConditionsCalls).toBe(0);
  });

  it('quota_exceeded and consent_required never carry a provider condition', async () => {
    const breaker = new ScriptedBreaker({
      open: ['ollama'],
      conditions: { ollama: 'rate_limited' },
    });
    const quota = new InMemoryQuotaPolicy(() =>
      Promise.resolve({
        allowed: false,
        retryAt: new Date('2026-09-18T10:00:00.000Z'),
      }),
    );
    const { runTask: quotaRun } = harness(
      [new FakeLlmProvider('ollama', [VALID])],
      { breaker, quota },
    );
    const quotaResult = await quotaRun.execute(classifySkillsTask, INPUT, {
      ...CONSENT,
      userId: 'user-1',
    });

    const { runTask: consentRun } = harness(
      [new FakeLlmProvider('openrouter', [VALID], EXTERNAL)],
      {
        breaker: new ScriptedBreaker({
          conditions: { openrouter: 'rate_limited' },
        }),
      },
    );
    const consentResult = await consentRun.execute(classifySkillsTask, INPUT, {
      aiConsent: { externalProviders: false },
    });

    expect(quotaResult).toMatchObject({ reason: 'quota_exceeded' });
    expect(quotaResult).not.toHaveProperty('providerCondition');
    expect(consentResult).toEqual({
      status: 'degraded',
      reason: 'consent_required',
    });
  });
});

describe('RunTask: consent and races in the provider condition (paste-fallback-honest 2.5c-ii)', () => {
  const NO_CONSENT: RunContext = { aiConsent: { externalProviders: false } };

  it('open external circuit without consent gives no_providers with consent_missing', async () => {
    const external = new FakeLlmProvider('openrouter', [VALID], EXTERNAL);
    // La clase recordada del circuito (`rate_limited`) no cuenta para quien no dio el permiso (N1).
    const breaker = new ScriptedBreaker({
      open: ['openrouter'],
      conditions: { openrouter: 'rate_limited' },
    });
    const { runTask } = harness([external], { breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, NO_CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'no_providers',
      providerCondition: { kind: 'consent_missing' },
    });
    expect(external.calls).toBe(0);
  });

  it('a half-open probe in flight counts with its remembered kind', async () => {
    const clock = new ManualClock();
    const breaker = new InMemoryCircuitBreaker(clock);
    for (let i = 0; i < 5; i++) {
      await breaker.recordFailure('ollama', { kind: 'rate_limited' });
    }
    clock.advance(30_000);
    // Otra ejecución tomó el permiso de prueba: para la instantánea el circuito sigue abierto.
    expect(await breaker.tryAcquire('ollama')).toBe(true);
    const provider = new FakeLlmProvider('ollama', [VALID]);
    const { runTask } = harness([provider], { clock, breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'no_providers',
      providerCondition: { kind: 'rate_limited' },
    });
    expect(provider.calls).toBe(0);
  });

  it('tryAcquire race with an external without consent gives no_providers with consent_missing', async () => {
    const local = new FakeLlmProvider('ollama', [VALID]);
    const external = new FakeLlmProvider('openrouter', [VALID], EXTERNAL);
    // `ollama` era elegible en la instantánea y otra ejecución tomó su permiso justo antes de enviar.
    const breaker = new ScriptedBreaker({ denied: ['ollama'] });
    const { runTask } = harness([local, external], { breaker });

    const result = await runTask.execute(classifySkillsTask, INPUT, NO_CONSENT);

    // Motivo `no_providers` y no `consent_required`: la cadena compuesta no estaba vacía (N2).
    expect(result).toEqual({
      status: 'degraded',
      reason: 'no_providers',
      providerCondition: { kind: 'consent_missing' },
    });
    expect(local.calls).toBe(0);
    expect(external.calls).toBe(0);
  });

  it('a local 503 without consent gives providers_failed with unavailable', async () => {
    const local = new FakeLlmProvider('ollama', [
      new ProviderUnavailable('ollama', 503),
    ]);
    const external = new FakeLlmProvider('openrouter', [VALID], EXTERNAL);
    const { runTask } = harness([local, external]);

    const result = await runTask.execute(classifySkillsTask, INPUT, NO_CONSENT);

    expect(result).toEqual({
      status: 'degraded',
      reason: 'providers_failed',
      providerCondition: { kind: 'unavailable' },
    });
    expect(external.calls).toBe(0);
  });
});
