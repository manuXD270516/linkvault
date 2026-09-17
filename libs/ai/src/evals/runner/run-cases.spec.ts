import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunTask } from '../../application/run-task.usecase';
import type { AnyAiTask } from '../../application/task-registry';
import { FixtureMissing, ProviderUnavailable } from '../../domain/errors';
import type { Clock } from '../../domain/ports/clock.port';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
} from '../../domain/ports/llm-provider.port';
import { FilePromptRegistry } from '../../infrastructure/prompt-registry/file-prompt-registry';
import { NullResultCache } from '../../application/null-result-cache';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import type { GoldenCase } from '../evaluable-task';
import { parseGolden } from '../golden.schema';
import { composeEvalRunTask } from './compose-run-task';
import {
  AllowAllQuotaPolicy,
  EvalUsageLedger,
  NullCircuitBreaker,
  StderrAiLogger,
} from './eval-ports';
import {
  caseContext,
  countCases,
  EvalCaseProgrammingError,
  runCases,
} from './run-cases';

// Tarea 3.2: ejecución secuencial de casos (D3 de ai-eval-harness; requisito "Corredor de evaluación").

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const PROMPTS_DIR = join(WORKSPACE_ROOT, 'libs/ai/src/infrastructure/prompts');

type SkillsCase = GoldenCase<{ text: string }, { skills: string[] }>;

function goldenCases(...lines: Record<string, unknown>[]): SkillsCase[] {
  const parsed = parseGolden(
    classifySkillsEvaluable,
    lines.map((line) => JSON.stringify(line)).join('\n'),
  );
  if (!parsed.ok) throw new Error('invalid test golden');
  return [...parsed.cases];
}

const CASES = goldenCases(
  {
    id: 'es-01',
    input: { text: 'Backend con TypeScript y Docker' },
    expected: { skills: ['TypeScript', 'Docker'] },
    tags: ['placeholder'],
  },
  {
    id: 'en-01',
    input: { text: 'Backend with TypeScript' },
    expected: { skills: ['TypeScript'] },
    tags: ['placeholder'],
    outputLanguage: 'en',
  },
);

/** Reloj que avanza `step` ms en cada lectura. */
function steppingClock(step: number): Clock {
  let now = 0;
  return {
    now: () => {
      now += step;
      return now;
    },
  };
}

const silentLogger = new StderrAiLogger(() => undefined);

describe('runCases with the mock in replay', () => {
  let fixturesDir: string;

  beforeEach(async () => {
    fixturesDir = await mkdtemp(join(tmpdir(), 'lv-eval-run-'));
    await mkdir(join(fixturesDir, 'classify-skills'));
  });

  afterEach(async () => {
    await rm(fixturesDir, { recursive: true, force: true });
  });

  async function writeFixture(goldenCase: SkillsCase, skills: string[]) {
    await writeFile(
      join(fixturesDir, 'classify-skills', `${goldenCase.key}.json`),
      JSON.stringify({
        source: 'handwritten',
        text: JSON.stringify({
          skills: skills.map((name) => ({ name, category: 'tool' })),
        }),
        model: 'fixture-model',
        usage: { inputTokens: 120, outputTokens: 30 },
      }),
    );
  }

  function replay() {
    const composed = composeEvalRunTask({
      env: { NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir },
      provider: 'mock',
      allowExternal: false,
      tasks: [classifySkillsTask as unknown as AnyAiTask],
      cwd: WORKSPACE_ROOT,
      logger: silentLogger,
    });
    if (!composed.ok) throw new Error(composed.error.kind);
    return composed.value;
  }

  it('runs every case in file order with its language, latency and usage from the ledger', async () => {
    const [es, en] = CASES as [SkillsCase, SkillsCase];
    await writeFixture(es, ['TypeScript', 'Docker']);
    await writeFixture(en, ['TypeScript']);
    const { runTask, ledger } = replay();

    const results = await runCases({
      evaluable: classifySkillsEvaluable,
      cases: CASES,
      runTask: runTask.execute,
      ledger,
      clock: steppingClock(7),
    });

    expect(results.map((r) => r.goldenCase.id)).toEqual(['es-01', 'en-01']);
    expect(results[0]).toMatchObject({
      result: { status: 'success', model: 'fixture-model' },
      latencyMs: 7,
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        estCost: 0,
        outcomes: ['success'],
      },
    });
    expect(results[1]?.result.status).toBe('success');
    expect(countCases(results)).toEqual({
      total: 2,
      success: 2,
      degraded: 0,
      providerErrors: 0,
      schemaErrors: 0,
    });
    expect(caseContext(en)).toEqual({
      aiConsent: { externalProviders: true },
      outputLanguage: 'en',
    });
  });

  it('Fixture ausente en replay: propagates the programming error with the case id and key', async () => {
    const [es, en] = CASES as [SkillsCase, SkillsCase];
    await writeFixture(es, ['TypeScript']);
    const { runTask, ledger } = replay();

    const run = runCases({
      evaluable: classifySkillsEvaluable,
      cases: CASES,
      runTask: runTask.execute,
      ledger,
      clock: steppingClock(1),
    });

    await expect(run).rejects.toBeInstanceOf(EvalCaseProgrammingError);
    const error = await run.catch((e: unknown) => e);
    expect(error).toMatchObject({
      caseId: 'en-01',
      key: en.key,
      taskName: 'classify-skills',
    });
    expect((error as EvalCaseProgrammingError).cause).toBeInstanceOf(
      FixtureMissing,
    );
    expect((error as Error).message).toContain('"en-01"');
    expect((error as Error).message).toContain(en.key);
  });
});

/** Proveedor local que siempre falla y comprueba que no hay dos peticiones a la vez. */
class FailingProvider implements LlmProvider {
  readonly id = 'ollama';
  readonly capabilities = {
    jsonMode: true,
    toolUse: false,
    maxContextTokens: 32_000,
    external: false,
    costPer1kIn: 0,
    costPer1kOut: 0,
  };
  readonly keys: string[] = [];
  private inFlight = 0;
  maxInFlight = 0;

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.keys.push(req.trace?.key ?? '');
    await new Promise((resolveLater) => setTimeout(resolveLater, 5));
    this.inFlight--;
    throw new ProviderUnavailable(this.id);
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

describe('runCases with a failing provider', () => {
  it('counts each case as degraded with its provider_error and degraded records, one case at a time', async () => {
    const provider = new FailingProvider();
    const ledger = new EvalUsageLedger();
    const runTask = new RunTask({
      providers: [provider],
      prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
      cache: new NullResultCache(),
      ledger,
      quota: new AllowAllQuotaPolicy(),
      breaker: new NullCircuitBreaker(),
      clock: { now: () => Date.now() },
      logger: silentLogger,
    });

    const results = await runCases({
      evaluable: classifySkillsEvaluable,
      cases: CASES,
      runTask: runTask.execute,
      ledger,
      clock: steppingClock(1),
    });

    expect(provider.keys).toEqual(CASES.map((c) => c.key));
    expect(provider.maxInFlight).toBe(1);
    for (const result of results) {
      expect(result.result).toEqual({
        status: 'degraded',
        reason: 'providers_failed',
      });
      expect(result.usage.outcomes).toEqual(['provider_error', 'degraded']);
    }
    expect(countCases(results)).toMatchObject({
      total: 2,
      success: 0,
      degraded: 2,
      providerErrors: 2,
    });
  });
});
