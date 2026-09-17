import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnyAiTask } from '../../application/task-registry';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import { goldenPath, loadGolden, parseGolden } from '../golden.schema';
import { computeMetrics } from '../metrics/aggregate';
import type { MetricValue } from '../metrics/metric';
import {
  baselinePath,
  buildBaseline,
  checkOrUpdateBaseline,
  compareWithBaseline,
  formatBaselineProblems,
  goldenSha256,
  readBaseline,
  serializeBaseline,
  updateBaselineCommand,
  type Baseline,
  type BaselineCheck,
} from './baseline';
import { composeEvalRunTask } from './compose-run-task';
import { StderrAiLogger } from './eval-ports';
import { runCases } from './run-cases';

// Tarea 3.4: línea base estricta en replay (D5 de ai-eval-harness; requisito "Línea base estricta en replay").

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const TASK = 'classify-skills';
const COMMAND =
  'nx run ai:eval --task=classify-skills --provider=mock --update-baseline';

const GOLDEN_LINES = [
  {
    id: 'es-01',
    input: { text: 'Backend con TypeScript, NestJS y Docker' },
    expected: { skills: ['TypeScript', 'NestJS', 'Docker'] },
    tags: ['placeholder'],
  },
  {
    id: 'en-01',
    input: { text: 'Frontend with Angular' },
    expected: { skills: ['Angular'] },
    tags: ['placeholder'],
    outputLanguage: 'en',
  },
];

function goldenContent(lines: readonly object[] = GOLDEN_LINES): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

describe('strict baseline in replay', () => {
  let root: string;
  let evalsDir: string;
  let fixturesDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-eval-baseline-'));
    evalsDir = join(root, 'evals');
    fixturesDir = join(root, 'fixtures');
    await mkdir(join(evalsDir, TASK), { recursive: true });
    await mkdir(join(fixturesDir, TASK), { recursive: true });
    await writeFile(goldenPath(evalsDir, TASK), goldenContent());
    await writeFixtures({
      'es-01': ['TypeScript', 'NestJS', 'Docker'],
      'en-01': ['Angular'],
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Fixtures de replay por `id` del golden actual. */
  async function writeFixtures(skillsById: Record<string, string[]>) {
    const golden = await loadGolden(classifySkillsEvaluable, evalsDir);
    if (!golden.ok) throw new Error('invalid test golden');
    for (const goldenCase of golden.cases) {
      const skills = skillsById[goldenCase.id];
      if (skills === undefined) continue;
      await writeFile(
        join(fixturesDir, TASK, `${goldenCase.key}.json`),
        JSON.stringify({
          source: 'handwritten',
          text: JSON.stringify({
            skills: skills.map((name) => ({ name, category: 'tool' })),
          }),
          model: 'fixture-model',
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      );
    }
  }

  /** Corredor en replay hasta el paso de línea base, como lo compondrá el CLI. */
  async function evaluate(update = false): Promise<BaselineCheck> {
    const golden = await loadGolden(classifySkillsEvaluable, evalsDir);
    if (!golden.ok) throw new Error('invalid test golden');
    const composed = composeEvalRunTask({
      env: { NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir },
      provider: 'mock',
      allowExternal: false,
      tasks: [classifySkillsTask as unknown as AnyAiTask],
      cwd: WORKSPACE_ROOT,
      logger: new StderrAiLogger(() => undefined),
    });
    if (!composed.ok) throw new Error(composed.error.kind);
    const { runTask, ledger, clock } = composed.value;
    const results = await runCases({
      evaluable: classifySkillsEvaluable,
      cases: golden.cases,
      runTask: runTask.execute,
      ledger,
      clock,
    });
    const metrics = computeMetrics(classifySkillsEvaluable, results);
    const current = buildBaseline({
      taskName: TASK,
      promptVersion: classifySkillsTask.promptVersion,
      cases: golden.cases,
      metrics,
    });
    return checkOrUpdateBaseline({ evalsDir, current, metrics, update });
  }

  function messagesOf(check: BaselineCheck): string[] {
    if (check.status !== 'differs') {
      throw new Error(`expected differs, got ${check.status}`);
    }
    return formatBaselineProblems(TASK, check.problems);
  }

  it('Sin regresión', async () => {
    await evaluate(true);

    await expect(evaluate()).resolves.toEqual({ status: 'matches' });
  });

  it('Regresión de recall', async () => {
    await evaluate(true);
    const stored = await readBaseline(evalsDir, TASK);
    expect(stored).toMatchObject({
      status: 'found',
      baseline: { metrics: { skills_recall: 1 } },
    });
    await writeFixtures({ 'es-01': ['TypeScript', 'NestJS'] });

    const check = await evaluate();

    expect(check).toMatchObject({
      status: 'differs',
      problems: [
        {
          kind: 'worsened',
          metric: 'skills_recall',
          baseline: 1,
          current: (2 / 3 + 1) / 2,
        },
      ],
    });
    const [message] = messagesOf(check);
    expect(message).toContain('skills_recall empeoró');
    expect(message).toContain('actual 0.8333333333333333');
    expect(message).toContain('línea base 1');
    expect(message).toContain(COMMAND);
  });

  it('Mejora sin actualizar la línea base', async () => {
    await writeFixtures({ 'es-01': ['TypeScript', 'NestJS'] });
    await evaluate(true);
    await writeFixtures({ 'es-01': ['TypeScript', 'NestJS', 'Docker'] });

    const check = await evaluate();

    expect(check).toMatchObject({
      status: 'differs',
      problems: [{ kind: 'improved', metric: 'skills_recall', current: 1 }],
    });
    const [message] = messagesOf(check);
    expect(message).toContain('skills_recall mejoró');
    expect(message).toContain('actualiza la línea base');
    expect(message).toContain(COMMAND);
  });

  it('Línea base ausente', async () => {
    const check = await evaluate();

    expect(check).toEqual({
      status: 'differs',
      problems: [{ kind: 'missing' }],
    });
    const [message] = messagesOf(check);
    expect(message).toContain('Sin línea base');
    expect(message).toContain(COMMAND);
  });

  it('Golden set modificado', async () => {
    await evaluate(true);
    await writeFile(
      goldenPath(evalsDir, TASK),
      goldenContent([
        GOLDEN_LINES[0] ?? {},
        { ...GOLDEN_LINES[1], expected: { skills: ['Angular', 'RxJS'] } },
      ]),
    );

    const check = await evaluate();

    expect(check).toEqual({
      status: 'differs',
      problems: [{ kind: 'golden_changed' }],
    });
    const [message] = messagesOf(check);
    expect(message).toContain('El golden cambió');
    expect(message).toContain(COMMAND);
  });

  it('Golden set modificado: converting the golden to CRLF does not change the hash', async () => {
    await evaluate(true);
    const lf = goldenContent();
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(crlf).not.toBe(lf);
    await writeFile(goldenPath(evalsDir, TASK), crlf);

    await expect(evaluate()).resolves.toEqual({ status: 'matches' });

    const lfCases = parseGolden(classifySkillsEvaluable, lf);
    const crlfCases = parseGolden(classifySkillsEvaluable, crlf);
    if (!lfCases.ok || !crlfCases.ok) throw new Error('invalid test golden');
    expect(goldenSha256(crlfCases.cases)).toBe(goldenSha256(lfCases.cases));
  });

  it('does not change the hash with spacing, key order or blank lines', () => {
    const reorderedFirstCase =
      '{ "tags": ["placeholder"],  "expected": { "skills": ["TypeScript", "NestJS", "Docker"] }, ' +
      '  "input": { "text": "Backend con TypeScript, NestJS y Docker" }, "id": "es-01" }';
    const content = [
      '',
      reorderedFirstCase,
      '',
      JSON.stringify(GOLDEN_LINES[1]),
      '',
    ].join('\n');
    const a = parseGolden(classifySkillsEvaluable, goldenContent());
    const b = parseGolden(classifySkillsEvaluable, content);
    if (!a.ok || !b.ok) throw new Error('invalid test golden');
    expect(goldenSha256(b.cases)).toBe(goldenSha256(a.cases));
  });

  it('Actualización consciente de la línea base', async () => {
    await writeFixtures({ 'es-01': ['TypeScript'] });
    await evaluate(true);
    await writeFixtures({ 'es-01': ['TypeScript', 'NestJS', 'Docker'] });
    expect((await evaluate()).status).toBe('differs');

    const updated = await evaluate(true);

    expect(updated).toEqual({
      status: 'updated',
      path: baselinePath(evalsDir, TASK),
    });
    await expect(evaluate()).resolves.toEqual({ status: 'matches' });
    const written = await readFile(baselinePath(evalsDir, TASK), 'utf8');
    expect(written).toBe(
      serializeBaseline({
        task: TASK,
        promptVersion: 'v1',
        goldenSha256: (JSON.parse(written) as Baseline).goldenSha256,
        metrics: {
          degraded_rate: 0,
          schema_validity_rate: 1,
          skills_precision: 1,
          skills_recall: 1,
        },
      }),
    );
  });
});

describe('baseline rules', () => {
  const metrics: MetricValue[] = [
    {
      name: 'schema_validity_rate',
      kind: 'blocking',
      direction: 'higher',
      value: 1,
    },
    { name: 'degraded_rate', kind: 'blocking', direction: 'lower', value: 0 },
    {
      name: 'latency_p50',
      kind: 'informational',
      direction: 'lower',
      value: 12,
    },
    {
      name: 'skills_recall',
      kind: 'blocking',
      direction: 'higher',
      value: 0.5,
    },
  ];
  const current = buildBaseline({
    taskName: TASK,
    promptVersion: 'v1',
    cases: [],
    metrics,
  });

  function withMetrics(values: Record<string, number>): Baseline {
    return { ...current, metrics: { ...current.metrics, ...values } };
  }

  it('keeps only blocking metrics with sorted keys', () => {
    expect(Object.keys(current.metrics)).toEqual([
      'degraded_rate',
      'schema_validity_rate',
      'skills_recall',
    ]);
    const serialized = serializeBaseline({
      ...current,
      metrics: { skills_recall: 0.5, degraded_rate: 0 },
    });
    expect(serialized.indexOf('degraded_rate')).toBeLessThan(
      serialized.indexOf('skills_recall'),
    );
    expect(serialized.endsWith('}\n')).toBe(true);
  });

  it('uses the metric direction to tell worse from better', () => {
    const worse = compareWithBaseline(
      { status: 'found', baseline: withMetrics({ degraded_rate: -0.1 }) },
      current,
      metrics,
    );
    const better = compareWithBaseline(
      { status: 'found', baseline: withMetrics({ degraded_rate: 0.2 }) },
      current,
      metrics,
    );
    expect(worse.problems).toEqual([
      { kind: 'worsened', metric: 'degraded_rate', baseline: -0.1, current: 0 },
    ]);
    expect(better.problems).toEqual([
      { kind: 'improved', metric: 'degraded_rate', baseline: 0.2, current: 0 },
    ]);
  });

  it('tolerates differences up to 1e-9', () => {
    expect(
      compareWithBaseline(
        {
          status: 'found',
          baseline: withMetrics({ skills_recall: 0.5 + 1e-10 }),
        },
        current,
        metrics,
      ).ok,
    ).toBe(true);
    expect(
      compareWithBaseline(
        {
          status: 'found',
          baseline: withMetrics({ skills_recall: 0.5 + 1e-8 }),
        },
        current,
        metrics,
      ).ok,
    ).toBe(false);
  });

  it('fails when the prompt version changed', () => {
    const comparison = compareWithBaseline(
      { status: 'found', baseline: { ...current, promptVersion: 'v0' } },
      current,
      metrics,
    );
    expect(comparison.problems).toEqual([
      { kind: 'prompt_changed', baseline: 'v0', current: 'v1' },
    ]);
    expect(formatBaselineProblems(TASK, comparison.problems)[0]).toBe(
      `[classify-skills] El prompt cambió: línea base v0, actual v1. Si el cambio es intencionado, ejecuta: ${COMMAND}`,
    );
  });

  it('fails when schema_validity_rate is below 1 even if it matches the baseline', () => {
    const degradedRun = withMetrics({ schema_validity_rate: 0.8 });
    const comparison = compareWithBaseline(
      { status: 'found', baseline: degradedRun },
      degradedRun,
      metrics,
    );
    expect(comparison.problems).toEqual([
      { kind: 'schema_validity_below_one', current: 0.8 },
    ]);
  });

  it('fails when a blocking metric is added or removed', () => {
    const rest = Object.fromEntries(
      Object.entries(current.metrics).filter(
        ([name]) => name !== 'skills_recall',
      ),
    );
    const comparison = compareWithBaseline(
      {
        status: 'found',
        baseline: { ...current, metrics: { ...rest, old_metric: 1 } },
      },
      current,
      metrics,
    );
    expect(comparison.problems).toEqual([
      { kind: 'metric_removed', metric: 'old_metric', baseline: 1 },
      { kind: 'metric_added', metric: 'skills_recall', current: 0.5 },
    ]);
  });

  it('includes the update command in every message', () => {
    const messages = formatBaselineProblems(TASK, [
      { kind: 'missing' },
      { kind: 'invalid' },
      { kind: 'golden_changed' },
      { kind: 'prompt_changed', baseline: 'v1', current: 'v2' },
      { kind: 'schema_validity_below_one', current: 0 },
      { kind: 'worsened', metric: 'm', baseline: 1, current: 0 },
      { kind: 'improved', metric: 'm', baseline: 0, current: 1 },
      { kind: 'metric_added', metric: 'm', current: 1 },
      { kind: 'metric_removed', metric: 'm', baseline: 1 },
    ]);
    expect(new Set(messages).size).toBe(9);
    for (const message of messages) expect(message).toContain(COMMAND);
    expect(updateBaselineCommand(TASK)).toBe(COMMAND);
  });

  describe('readBaseline', () => {
    let evalsDir: string;

    beforeEach(async () => {
      evalsDir = await mkdtemp(join(tmpdir(), 'lv-eval-baseline-read-'));
      await mkdir(join(evalsDir, TASK));
    });

    afterEach(async () => {
      await rm(evalsDir, { recursive: true, force: true });
    });

    it('distinguishes a missing, malformed or foreign baseline', async () => {
      await expect(readBaseline(evalsDir, TASK)).resolves.toEqual({
        status: 'missing',
      });
      await writeFile(baselinePath(evalsDir, TASK), '{ not json');
      await expect(readBaseline(evalsDir, TASK)).resolves.toEqual({
        status: 'invalid',
      });
      await writeFile(
        baselinePath(evalsDir, TASK),
        serializeBaseline({
          ...current,
          task: 'extract-job',
          goldenSha256: 'a'.repeat(64),
        }),
      );
      await expect(readBaseline(evalsDir, TASK)).resolves.toEqual({
        status: 'invalid',
      });
    });
  });
});
