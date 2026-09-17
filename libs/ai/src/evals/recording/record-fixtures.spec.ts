import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullResultCache } from '../../application/null-result-cache';
import { RunTask } from '../../application/run-task.usecase';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
} from '../../domain/ports/llm-provider.port';
import { FilePromptRegistry } from '../../infrastructure/prompt-registry/file-prompt-registry';
import type { GoldenCase } from '../evaluable-task';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import { parseGolden } from '../golden.schema';
import {
  AllowAllQuotaPolicy,
  EvalUsageLedger,
  NullCircuitBreaker,
  StderrAiLogger,
} from '../runner/eval-ports';
import { fixturePath, recordFixtures } from './record-fixtures';

// Tarea 4.1: escritura de fixtures en `success`, `overwrite` y casos no grabados (D7 de ai-eval-harness), con un
// upstream falso en memoria.

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

const [FIRST, SECOND] = goldenCases(
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
) as [SkillsCase, SkillsCase];

const VALID_TEXT = JSON.stringify({
  skills: [{ name: 'TypeScript', category: 'language' }],
});

/** Upstream falso: responde según el texto del mensaje de usuario y guarda las claves recibidas. */
class FakeUpstream implements LlmProvider {
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

  constructor(private readonly reply: (req: CompletionRequest) => string) {}

  complete(req: CompletionRequest): Promise<CompletionResult> {
    this.keys.push(req.trace?.key ?? '');
    return Promise.resolve({
      text: this.reply(req),
      usage: { inputTokens: 200, outputTokens: 25 },
      model: 'qwen2.5:7b',
      latencyMs: 3,
    });
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function composeWith(provider: LlmProvider) {
  const ledger = new EvalUsageLedger();
  const runTask = new RunTask({
    providers: [provider],
    prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
    cache: new NullResultCache(),
    ledger,
    quota: new AllowAllQuotaPolicy(),
    breaker: new NullCircuitBreaker(),
    clock: { now: () => Date.now() },
    logger: new StderrAiLogger(() => undefined),
  });
  return { runTask: runTask.execute, ledger };
}

describe('recordFixtures with an in-memory upstream', () => {
  let fixturesDir: string;

  beforeEach(async () => {
    fixturesDir = await mkdtemp(join(tmpdir(), 'lv-eval-record-'));
  });

  afterEach(async () => {
    await rm(fixturesDir, { recursive: true, force: true });
  });

  const pathOf = (goldenCase: SkillsCase) =>
    fixturePath(fixturesDir, 'classify-skills', goldenCase.key);

  it('writes a fixture per success with source, model, output and usage from the ledger', async () => {
    const upstream = new FakeUpstream(() => VALID_TEXT);
    const { runTask, ledger } = composeWith(upstream);

    const summary = await recordFixtures({
      evaluable: classifySkillsEvaluable,
      cases: [FIRST, SECOND],
      runTask,
      ledger,
      fixturesDir,
      upstream: 'ollama',
      overwrite: false,
    });

    expect(summary).toEqual({
      recorded: ['es-01', 'en-01'],
      skipped: [],
      failed: [],
    });
    expect(upstream.keys).toEqual([FIRST.key, SECOND.key]);
    const fixture = JSON.parse(await readFile(pathOf(FIRST), 'utf8')) as unknown;
    expect(fixture).toEqual({
      source: 'recorded:ollama:qwen2.5:7b',
      text: VALID_TEXT,
      model: 'qwen2.5:7b',
      usage: { inputTokens: 200, outputTokens: 25 },
    });
    // Nada del input en el fixture.
    expect(await readFile(pathOf(FIRST), 'utf8')).not.toContain('Docker');
    expect(ledger.recordsFor(FIRST.key)).toEqual([]);
  });

  it('Fixture existente: leaves it untouched and sends no request for that case', async () => {
    const existing = '{"source":"handwritten","keep":true}\n';
    await mkdir(join(fixturesDir, 'classify-skills'));
    await writeFile(pathOf(FIRST), existing);
    const upstream = new FakeUpstream(() => VALID_TEXT);
    const { runTask, ledger } = composeWith(upstream);

    const summary = await recordFixtures({
      evaluable: classifySkillsEvaluable,
      cases: [FIRST, SECOND],
      runTask,
      ledger,
      fixturesDir,
      upstream: 'ollama',
      overwrite: false,
    });

    expect(summary).toEqual({
      recorded: ['en-01'],
      skipped: ['es-01'],
      failed: [],
    });
    expect(upstream.keys).toEqual([SECOND.key]);
    expect(await readFile(pathOf(FIRST), 'utf8')).toBe(existing);
  });

  it('overwrites an existing fixture only with overwrite', async () => {
    await mkdir(join(fixturesDir, 'classify-skills'));
    await writeFile(pathOf(FIRST), '{"source":"handwritten"}\n');
    const upstream = new FakeUpstream(() => VALID_TEXT);
    const { runTask, ledger } = composeWith(upstream);

    const summary = await recordFixtures({
      evaluable: classifySkillsEvaluable,
      cases: [FIRST],
      runTask,
      ledger,
      fixturesDir,
      upstream: 'ollama',
      overwrite: true,
    });

    expect(summary.recorded).toEqual(['es-01']);
    expect(upstream.keys).toEqual([FIRST.key]);
    expect(await readFile(pathOf(FIRST), 'utf8')).toContain(
      'recorded:ollama:qwen2.5:7b',
    );
  });

  it('Respuesta inválida no se graba: writes nothing for the case and lists it as failed', async () => {
    // Inválida en la petición original y en la reparación solo para el primer caso.
    const upstream = new FakeUpstream((req) =>
      req.trace?.key === FIRST.key ? '{"skills":"none"}' : VALID_TEXT,
    );
    const { runTask, ledger } = composeWith(upstream);

    const summary = await recordFixtures({
      evaluable: classifySkillsEvaluable,
      cases: [FIRST, SECOND],
      runTask,
      ledger,
      fixturesDir,
      upstream: 'ollama',
      overwrite: false,
    });

    expect(upstream.keys).toEqual([FIRST.key, FIRST.key, SECOND.key]);
    expect(summary.recorded).toEqual(['en-01']);
    expect(summary.failed).toEqual([
      {
        id: 'es-01',
        reason:
          'degraded (providers_failed); ledger outcomes: [schema_error, degraded]',
      },
    ]);
    await expect(readFile(pathOf(FIRST), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not record a success coming from a provider other than the upstream', async () => {
    const upstream = new FakeUpstream(() => VALID_TEXT);
    const { runTask, ledger } = composeWith(upstream);

    const summary = await recordFixtures({
      evaluable: classifySkillsEvaluable,
      cases: [FIRST],
      runTask,
      ledger,
      fixturesDir,
      upstream: 'openrouter',
      overwrite: false,
    });

    expect(summary.recorded).toEqual([]);
    expect(summary.failed).toEqual([
      {
        id: 'es-01',
        reason: 'success from provider ollama, expected upstream openrouter',
      },
    ]);
    await expect(readFile(pathOf(FIRST), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
