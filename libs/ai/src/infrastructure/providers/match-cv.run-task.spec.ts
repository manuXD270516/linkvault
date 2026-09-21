import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executionKey } from '../../application/execution-key';
import { RunTask } from '../../application/run-task.usecase';
import { TaskRegistry } from '../../application/task-registry';
import {
  InMemoryAiLogger,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
} from '../../application/testing/in-memory-ports';
import { FakeLlmProvider } from '../../application/testing/fake-llm-provider';
import type { RunContext } from '../../domain/run-context';
import { FilePromptRegistry } from '../prompt-registry/file-prompt-registry';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import { MockDeterministicProvider } from './mock-deterministic.provider';
import {
  matchCvOutputSchema,
  matchCvTask,
  type MatchCvInput,
} from '../../tasks/match-cv.task';

// Integración de `match-cv` con el mock (synth/replay) y el camino de salida inválida (tareas 3.13–3.14).

const PROMPTS_DIR = join(import.meta.dirname, '../prompts');
const CTX: RunContext = { aiConsent: { externalProviders: false } };

const INPUT: MatchCvInput = {
  job: {
    title: 'Backend',
    text: 'Buscamos TypeScript y Kubernetes.',
    skills: [
      { name: 'TypeScript', importance: 'must' },
      { name: 'Kubernetes', importance: 'must' },
    ],
  },
  cv: {
    text: 'Desarrollador con TypeScript en NestJS.',
  },
};

let emptyFixturesDir: string;

beforeAll(async () => {
  emptyFixturesDir = await mkdtemp(join(tmpdir(), 'lv-match-cv-synth-'));
});

afterAll(async () => {
  await rm(emptyFixturesDir, { recursive: true, force: true });
});

function synthRunTask(): RunTask {
  const clock = new ManualClock();
  return new RunTask({
    providers: [
      new MockDeterministicProvider({
        mode: 'synth',
        fixturesDir: emptyFixturesDir,
        tasks: new TaskRegistry([matchCvTask]),
      }),
    ],
    prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
    cache: new InMemoryResultCache(),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new InMemoryCircuitBreaker(clock),
    clock,
    logger: new InMemoryAiLogger(),
  });
}

describe('runTask match-cv with mock synth', () => {
  it('returns a valid output at temperature 0 with cached:false', async () => {
    const runTask = synthRunTask();
    const result = await runTask.execute(matchCvTask, INPUT, CTX);

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'mock',
      promptVersion: 'v1',
      cached: false,
    });
    if (result.status !== 'success') throw new Error('expected success');
    expect(matchCvOutputSchema.safeParse(result.output).success).toBe(true);
    expect(result.output.matchedSkills).toContain('TypeScript');
    expect(result.output.suggestions.length).toBeLessThanOrEqual(12);
  });

  it('replays a handwritten fixture with cached:false', async () => {
    const fixturesRoot = await mkdtemp(join(tmpdir(), 'lv-match-cv-replay-'));
    const key = executionKey({
      taskName: 'match-cv',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: matchCvTask.inputSchema.parse(INPUT),
    });
    const output = {
      score: 50,
      matchedSkills: ['TypeScript'],
      missingSkills: [{ name: 'Kubernetes', importance: 'must' }],
      suggestions: [
        {
          section: 'skills',
          after: 'Incluir Kubernetes.',
          reason: 'La vacante lo exige.',
          evidence: {
            jobRequirement: 'Kubernetes',
            importance: 'must',
            cvFragment: null,
          },
        },
      ],
    };
    await mkdir(join(fixturesRoot, 'match-cv'), { recursive: true });
    await writeFile(
      join(fixturesRoot, 'match-cv', `${key}.json`),
      JSON.stringify({
        source: 'handwritten',
        text: JSON.stringify(output),
        model: 'handwritten',
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
      'utf8',
    );

    const clock = new ManualClock();
    const runTask = new RunTask({
      providers: [
        new MockDeterministicProvider({
          mode: 'replay',
          fixturesDir: fixturesRoot,
        }),
      ],
      prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
      cache: new InMemoryResultCache(),
      ledger: new InMemoryUsageLedger(),
      quota: new InMemoryQuotaPolicy(),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      logger: new InMemoryAiLogger(),
      pendingFixtures: null,
    });

    try {
      const result = await runTask.execute(matchCvTask, INPUT, CTX);
      expect(result).toEqual({
        status: 'success',
        output,
        providerId: 'mock',
        model: 'handwritten',
        promptVersion: 'v1',
        cached: false,
      });
    } finally {
      await rm(fixturesRoot, { recursive: true, force: true });
    }
  });

  it('degrades with RuleBasedMatcher output when the chain is empty', async () => {
    const clock = new ManualClock();
    const runTask = new RunTask({
      providers: [],
      prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
      cache: new InMemoryResultCache(),
      ledger: new InMemoryUsageLedger(),
      quota: new InMemoryQuotaPolicy(),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      logger: new InMemoryAiLogger(),
    });

    const result = await runTask.execute(matchCvTask, INPUT, CTX);

    expect(result).toMatchObject({
      status: 'degraded',
      reason: 'no_providers',
      output: {
        suggestions: [],
        matchedSkills: ['TypeScript'],
        missingSkills: [{ name: 'Kubernetes', importance: 'must' }],
      },
    });
    expect(result).not.toHaveProperty('aiQuotaRetryAt');
  });
});

describe('runTask match-cv invalid output path', () => {
  it('repairs then falls through providers and degrades without returning invalid output', async () => {
    const invalid = JSON.stringify({
      score: 50,
      matchedSkills: ['TypeScript'],
      missingSkills: [{ name: 'Kubernetes', importance: 'must' }],
      suggestions: [
        {
          section: 'skills',
          after: 'Añadir Kubernetes',
          reason: 'Falta',
          evidence: {
            // Falta jobRequirement e importance: salida inválida.
            cvFragment: null,
          },
        },
      ],
    });
    const stillInvalid = invalid;
    const first = new FakeLlmProvider('ollama', [invalid, stillInvalid]);
    const second = new FakeLlmProvider('openrouter', [invalid, stillInvalid], {
      capabilities: { external: true },
    });
    const clock = new ManualClock();
    const cache = new InMemoryResultCache();
    const runTask = new RunTask({
      providers: [first, second],
      prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
      cache,
      ledger: new InMemoryUsageLedger(),
      quota: new InMemoryQuotaPolicy(),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      logger: new InMemoryAiLogger(),
      pendingFixtures: null,
    });

    const result = await runTask.execute(matchCvTask, INPUT, {
      aiConsent: { externalProviders: true },
    });

    // maxAttempts=2 → original + reparación por proveedor.
    expect(first.calls).toBe(2);
    expect(second.calls).toBe(2);
    expect(result).toMatchObject({
      status: 'degraded',
      reason: 'providers_failed',
      output: { suggestions: [] },
    });
    if (result.status !== 'degraded' || result.output === undefined) {
      throw new Error('expected degraded output');
    }
    expect(matchCvOutputSchema.safeParse(result.output).success).toBe(true);
    // Nada de la salida inválida se guarda en caché.
    expect(cache.sets).toBe(0);
    expect(cache.entries.size).toBe(0);
  });
});
