import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClassifySkillsOutput } from '../../tasks/classify-skills.task';
import type { ClassifySkillsExpected } from '../classify-skills/metrics';
import type { CaseResult } from '../evaluable-task';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import { computeMetrics } from '../metrics/aggregate';
import {
  degraded,
  success,
  testCaseResult,
} from '../metrics/test-cases.spec-helper';
import { formatNumber, renderReport, reportModel, writeReport } from './report';

// Tarea 3.3: reporte Markdown (D6 de ai-eval-harness; requisito "Corredor de evaluación").

const INPUT_TEXTS = [
  'Buscamos backend con TypeScript, NestJS y Docker. Contacto: rrhh@example.com',
  'Senior frontend | Angular',
];

function skillsOutput(...names: string[]): ClassifySkillsOutput {
  return { skills: names.map((name) => ({ name, category: 'tool' })) };
}

function fixedResults(
  tags: readonly string[],
): CaseResult<
  { text: string },
  ClassifySkillsOutput,
  ClassifySkillsExpected
>[] {
  return [
    testCaseResult({
      id: 'es-01',
      input: { text: INPUT_TEXTS[0] ?? '' },
      expected: { skills: ['TypeScript', 'NestJS', 'Docker'] },
      result: success(
        skillsOutput('typescript', 'NestJS', 'Kafka'),
        'qwen2.5:7b',
      ),
      latencyMs: 1200,
      tags,
    }),
    testCaseResult({
      id: 'en-01',
      input: { text: INPUT_TEXTS[1] ?? '' },
      expected: { skills: ['Angular'] },
      result: degraded(),
      latencyMs: 30,
      tags,
    }),
  ];
}

const GENERATED_AT = new Date('2026-09-17T10:00:00.000Z');

describe('renderReport', () => {
  it('renders header, placeholder warning, metrics with kind and baseline, and one row per case', () => {
    const results = fixedResults(['placeholder', 'es']);
    const markdown = renderReport({
      evaluable: classifySkillsEvaluable,
      providerId: 'mock',
      model: reportModel(results),
      generatedAt: GENERATED_AT,
      metrics: computeMetrics(classifySkillsEvaluable, results),
      baseline: {
        degraded_rate: 0.5,
        schema_validity_rate: 0.5,
        skills_precision: 1,
        skills_recall: 1,
      },
      results,
    });

    expect(markdown).toBe(
      [
        '# Evaluación de IA: classify-skills',
        '',
        '- Tarea: `classify-skills`',
        '- Prompt: `v1`',
        '- Proveedor: `mock`',
        '- Modelo: qwen2.5:7b',
        '- Fecha: 2026-09-17T10:00:00.000Z',
        '- Casos: 2',
        '',
        '> **Advertencia:** golden set `placeholder` (2 de 2 casos): son casos sintéticos y las métricas no representan calidad real.',
        '',
        '## Métricas',
        '',
        '| Métrica | Tipo | Valor | Línea base |',
        '| --- | --- | --- | --- |',
        '| `schema_validity_rate` | bloqueante | 0.5 | 0.5 |',
        '| `degraded_rate` | bloqueante | 0.5 | 0.5 |',
        '| `latency_p50` | informativa | 615 | — |',
        '| `cost_per_run` | informativa | 0 | — |',
        '| `skills_recall` | bloqueante | 0.666667 | 1 |',
        '| `skills_precision` | bloqueante | 0.666667 | 1 |',
        '',
        '## Casos',
        '',
        '| id | tags | Estado | Latencia (ms) | Skills faltantes | Skills sobrantes |',
        '| --- | --- | --- | --- | --- | --- |',
        '| `es-01` | placeholder, es | success | 1200 | docker | kafka |',
        '| `en-01` | placeholder, es | degraded (providers_failed) | 30 |  |  |',
        '',
      ].join('\n'),
    );
  });

  it('does not contain the text of any input', () => {
    const results = fixedResults(['placeholder']);
    const markdown = renderReport({
      evaluable: classifySkillsEvaluable,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      generatedAt: GENERATED_AT,
      metrics: computeMetrics(classifySkillsEvaluable, results),
      results,
    });

    for (const text of INPUT_TEXTS) expect(markdown).not.toContain(text);
    expect(markdown).not.toContain('rrhh@example.com');
    expect(markdown).not.toContain('Buscamos');
  });

  it('omits the warning without placeholder cases and the baseline column for real providers', () => {
    const results = fixedResults(['real']);
    const markdown = renderReport({
      evaluable: classifySkillsEvaluable,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      generatedAt: GENERATED_AT,
      metrics: computeMetrics(classifySkillsEvaluable, results),
      results,
    });

    expect(markdown).not.toContain('Advertencia');
    expect(markdown).toContain(
      '| Métrica | Tipo | Valor |\n| --- | --- | --- |',
    );
  });

  it('shows an empty baseline column when the baseline is missing', () => {
    const results = fixedResults([]);
    const markdown = renderReport({
      evaluable: classifySkillsEvaluable,
      providerId: 'mock',
      model: 'x',
      generatedAt: GENERATED_AT,
      metrics: computeMetrics(classifySkillsEvaluable, results),
      baseline: null,
      results,
    });

    expect(markdown).toContain(
      '| `skills_recall` | bloqueante | 0.666667 | — |',
    );
  });

  it('escapes pipes and line breaks in cells', () => {
    const results = [
      testCaseResult({
        id: 'es-01',
        input: { text: 'x' },
        expected: { skills: [] },
        result: success(skillsOutput('CI|CD\nGitHub')),
      }),
    ];
    const markdown = renderReport({
      evaluable: classifySkillsEvaluable,
      providerId: 'mock',
      model: 'a|b',
      generatedAt: GENERATED_AT,
      metrics: [],
      results,
    });

    expect(markdown).toContain('- Modelo: a\\|b');
    expect(markdown).toContain('| ci\\|cd github |');
  });

  it('distinguishes cost of each judge-loop round', () => {
    const results = fixedResults(['judge-loop']);
    results[0]!.usage = {
      ...results[0]!.usage,
      estCost: 0.03,
      rounds: [
        { round: 0, task: 'match-cv', estCost: 0.01, latencyMs: 100 },
        { round: 1, task: 'critique-suggestions', estCost: 0.005, latencyMs: 50 },
        { round: 2, task: 'match-cv', estCost: 0.015, latencyMs: 120 },
      ],
    };
    const markdown = renderReport({
      evaluable: classifySkillsEvaluable,
      providerId: 'mock',
      model: 'm',
      generatedAt: GENERATED_AT,
      metrics: [],
      results,
      roundCosts: [
        { round: 0, task: 'match-cv', estCost: 0.01 },
        { round: 1, task: 'critique-suggestions', estCost: 0.005 },
        { round: 2, task: 'match-cv', estCost: 0.015 },
      ],
    });

    expect(markdown).toContain('## Coste por vuelta');
    expect(markdown).toContain('| 0 | `match-cv` | 0.01 |');
    expect(markdown).toContain('| 1 | `critique-suggestions` | 0.005 |');
    expect(markdown).toContain('| 2 | `match-cv` | 0.015 |');
  });
});

describe('reportModel and formatNumber', () => {
  it('lists distinct success models or falls back to the configured model', () => {
    expect(reportModel(fixedResults([]))).toBe('qwen2.5:7b');
    expect(reportModel(fixedResults([]).slice(1), 'qwen2.5:7b')).toBe(
      'qwen2.5:7b',
    );
    expect(reportModel([])).toBe('—');
  });

  it('formats integers as is and other numbers with 6 significant digits', () => {
    expect(formatNumber(3)).toBe('3');
    expect(formatNumber(2 / 3)).toBe('0.666667');
    expect(formatNumber(0.000015)).toBe('0.000015');
  });
});

describe('writeReport', () => {
  let reportsDir: string;

  beforeEach(async () => {
    reportsDir = await mkdtemp(join(tmpdir(), 'lv-eval-report-'));
  });

  afterEach(async () => {
    await rm(reportsDir, { recursive: true, force: true });
  });

  it('writes <reportsDir>/<task>/<provider>.md and returns its path', async () => {
    const path = await writeReport(
      reportsDir,
      'classify-skills',
      'mock',
      '# r\n',
    );

    expect(path).toBe(join(reportsDir, 'classify-skills', 'mock.md'));
    await expect(readFile(path, 'utf8')).resolves.toBe('# r\n');
  });
});
