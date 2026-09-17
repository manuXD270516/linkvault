import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
import { FixtureMissing, SynthUnsupported } from '../../domain/errors';
import type { RunContext } from '../../domain/run-context';
import {
  classifySkillsOutputSchema,
  classifySkillsTask,
} from '../../tasks/classify-skills.task';
import { FilePromptRegistry } from '../prompt-registry/file-prompt-registry';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import { MockDeterministicProvider } from './mock-deterministic.provider';

// Tareas 7.2 y 7.3: modos synth y replay de punta a punta con runTask, el mock real, el prompt real y classify-skills
// (specs/ai/deterministic-mock, requisitos "Modo replay" y "Modo synth").

const PROMPTS_DIR = join(import.meta.dirname, '../prompts');
const CTX: RunContext = { aiConsent: { externalProviders: false } };

/** Directorio de fixtures vacío: obliga a sintetizar en lugar de leer fixtures escritos a mano. */
let emptyFixturesDir: string;

beforeAll(async () => {
  emptyFixturesDir = await mkdtemp(join(tmpdir(), 'lv-synth-fixtures-'));
});

afterAll(async () => {
  await rm(emptyFixturesDir, { recursive: true, force: true });
});

function synthRunTask(tasks: TaskRegistry): {
  runTask: RunTask;
  cache: InMemoryResultCache;
} {
  const clock = new ManualClock();
  const cache = new InMemoryResultCache();
  const runTask = new RunTask({
    providers: [
      new MockDeterministicProvider({
        mode: 'synth',
        fixturesDir: emptyFixturesDir,
        tasks,
      }),
    ],
    prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
    cache,
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new InMemoryCircuitBreaker(clock),
    clock,
    logger: new InMemoryAiLogger(),
  });
  return { runTask, cache };
}

/** Fixtures reales de replay (tarea 7.3), escritos a mano con `"source": "handwritten"`. */
const FIXTURES_DIR = join(import.meta.dirname, '../fixtures');

/** Inputs de test de classify-skills con fixture de replay y la salida escrita a mano que devuelven. */
const REPLAY_CASES = [
  {
    outputLanguage: 'es',
    input: { text: 'TypeScript y NestJS' },
    skills: [
      { name: 'TypeScript', category: 'language' },
      { name: 'NestJS', category: 'framework' },
    ],
  },
  {
    outputLanguage: 'en',
    input: { text: 'TypeScript y NestJS' },
    skills: [
      { name: 'TypeScript', category: 'language' },
      { name: 'NestJS', category: 'framework' },
    ],
  },
  {
    outputLanguage: 'es',
    input: { text: 'Backend con TypeScript y NestJS' },
    skills: [
      { name: 'Backend', category: 'domain' },
      { name: 'TypeScript', category: 'language' },
      { name: 'NestJS', category: 'framework' },
    ],
  },
] as const;

function replayRunTask(fixturesDir = FIXTURES_DIR): RunTask {
  const clock = new ManualClock();
  return new RunTask({
    providers: [new MockDeterministicProvider({ mode: 'replay', fixturesDir })],
    prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
    cache: new InMemoryResultCache(),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new InMemoryCircuitBreaker(clock),
    clock,
    logger: new InMemoryAiLogger(),
  });
}

describe('runTask with the mock in replay mode (handwritten fixtures)', () => {
  it.each(REPLAY_CASES)(
    'Fixture existente: $input.text ($outputLanguage)',
    async ({ input, outputLanguage, skills }) => {
      const result = await replayRunTask().execute(classifySkillsTask, input, {
        ...CTX,
        outputLanguage,
      });

      expect(result).toEqual({
        status: 'success',
        output: { skills },
        providerId: 'mock',
        model: 'handwritten',
        promptVersion: 'v1',
        cached: false,
      });
    },
  );

  it('Fixture ausente en CI', async () => {
    const input = { text: 'Un input sin fixture grabado' };
    const key = executionKey({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input,
    });

    const run = replayRunTask().execute(classifySkillsTask, input, CTX);

    await expect(run).rejects.toBeInstanceOf(FixtureMissing);
    await expect(run).rejects.toMatchObject({ key });
  });

  it('keeps a valid handwritten fixture for every replay case', async () => {
    const dir = join(FIXTURES_DIR, 'classify-skills');
    const expectedKeys = REPLAY_CASES.map(({ input, outputLanguage }) =>
      executionKey({
        taskName: 'classify-skills',
        promptVersion: 'v1',
        outputLanguage,
        input,
      }),
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));

    expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(
      expect.arrayContaining(expectedKeys),
    );
    for (const file of files) {
      const fixture = JSON.parse(await readFile(join(dir, file), 'utf8')) as {
        source: string;
        text: string;
      };
      expect(fixture.source).toBe('handwritten');
      expect(
        classifySkillsOutputSchema.safeParse(JSON.parse(fixture.text)).success,
      ).toBe(true);
    }
  });
});

describe('runTask with the mock in synth mode', () => {
  it('Mismo input dos veces en modo synth', async () => {
    const input = {
      text: 'Buscamos backend con NestJS, TypeScript, MongoDB y Docker; inglés intermedio.',
    };
    const first = synthRunTask(new TaskRegistry([classifySkillsTask]));
    const second = synthRunTask(new TaskRegistry([classifySkillsTask]));

    const a = await first.runTask.execute(classifySkillsTask, input, CTX);
    const b = await first.runTask.execute(classifySkillsTask, input, CTX);
    const c = await second.runTask.execute(classifySkillsTask, input, CTX);

    expect(a.status).toBe('success');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    // Con el mock en la cadena la caché no se usa: la segunda salida es una nueva síntesis, no una lectura.
    expect(b).toMatchObject({ cached: false });
    expect(first.cache.gets + first.cache.sets).toBe(0);
  });

  it('Salida sintetizada válida y creíble', async () => {
    const { runTask } = synthRunTask(new TaskRegistry([classifySkillsTask]));

    const result = await runTask.execute(
      classifySkillsTask,
      { text: 'Experiencia de 3 años con TypeScript y Angular.' },
      CTX,
    );

    expect(result).toMatchObject({
      status: 'success',
      providerId: 'mock',
      promptVersion: 'v1',
    });
    if (result.status !== 'success') throw new Error('expected success');
    expect(classifySkillsOutputSchema.safeParse(result.output).success).toBe(
      true,
    );
    expect(result.output.skills).toContainEqual({
      name: 'TypeScript',
      category: 'language',
    });
  });

  it('Tarea sin muestra', async () => {
    const withoutSample = { ...classifySkillsTask, sample: undefined };
    const { runTask } = synthRunTask(new TaskRegistry([withoutSample]));

    const run = runTask.execute(
      withoutSample,
      { text: 'TypeScript y NestJS' },
      CTX,
    );

    await expect(run).rejects.toBeInstanceOf(SynthUnsupported);
    await expect(run).rejects.toMatchObject({ taskName: 'classify-skills' });
  });
});
