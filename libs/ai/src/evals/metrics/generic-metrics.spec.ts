import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import { eraseEvaluableTask } from '../evaluable-task';
import { computeMetrics, DuplicatedMetricName } from './aggregate';
import {
  computeGenericMetrics,
  costPerRun,
  degradedRate,
  latencyP50,
  median,
  schemaValidityRate,
} from './generic-metrics';
import { degraded, success, testCaseResult } from './test-cases.spec-helper';

// Tarea 2.1 (specs/ai/eval-harness, requisito "Métricas"; D5 de ai-eval-harness).

function caseWith(status: 'success' | 'degraded', latencyMs = 0, estCost = 0) {
  return testCaseResult({
    id: `case-${String(latencyMs)}`,
    input: {},
    expected: {},
    result: status === 'success' ? success({}) : degraded(),
    latencyMs,
    estCost,
  });
}

describe('generic metrics', () => {
  it('Caso degradado', () => {
    const cases = [
      caseWith('success'),
      caseWith('success'),
      caseWith('degraded'),
      caseWith('success'),
      caseWith('success'),
    ];

    expect(degradedRate(cases)).toBe(0.2);
    expect(schemaValidityRate(cases)).toBe(0.8);
  });

  it('computes latency_p50 with an odd number of cases', () => {
    const cases = [30, 10, 50, 20, 40].map((ms) => caseWith('success', ms));
    expect(latencyP50(cases)).toBe(30);
  });

  it('computes latency_p50 with an even number of cases as the mean of the middle ones', () => {
    const cases = [40, 10, 30, 20].map((ms) => caseWith('success', ms));
    expect(latencyP50(cases)).toBe(25);
  });

  it('computes cost_per_run as the mean estimated cost per case', () => {
    const cases = [
      caseWith('success', 1, 0.002),
      caseWith('degraded', 2, 0.001),
    ];
    expect(costPerRun(cases)).toBeCloseTo(0.0015, 12);
  });

  it('returns 0 for every metric over an empty set', () => {
    expect(median([])).toBe(0);
    expect(computeGenericMetrics([]).map((m) => m.value)).toEqual([0, 0, 0, 0]);
  });

  it('declares kind and direction of each generic metric', () => {
    expect(
      computeGenericMetrics([caseWith('success')]).map(
        ({ name, kind, direction }) => ({ name, kind, direction }),
      ),
    ).toEqual([
      { name: 'schema_validity_rate', kind: 'blocking', direction: 'higher' },
      { name: 'degraded_rate', kind: 'blocking', direction: 'lower' },
      { name: 'latency_p50', kind: 'informational', direction: 'lower' },
      { name: 'cost_per_run', kind: 'informational', direction: 'lower' },
    ]);
  });
});

describe('computeMetrics', () => {
  const base = eraseEvaluableTask({
    task: classifySkillsTask,
    expectedSchema: z.unknown(),
    metrics: [],
  });

  it('appends the task metrics as blocking after the generic ones', () => {
    const metrics = computeMetrics(
      {
        ...base,
        metrics: [
          { name: 'own_metric', direction: 'higher', compute: (c) => c.length },
        ],
      },
      [caseWith('success'), caseWith('degraded')],
    );

    expect(metrics.map((m) => m.name)).toEqual([
      'schema_validity_rate',
      'degraded_rate',
      'latency_p50',
      'cost_per_run',
      'own_metric',
    ]);
    expect(metrics[4]).toEqual({
      name: 'own_metric',
      kind: 'blocking',
      direction: 'higher',
      value: 2,
    });
  });

  it('rejects a task metric that reuses a metric name', () => {
    expect(() =>
      computeMetrics(
        {
          ...base,
          metrics: [
            { name: 'degraded_rate', direction: 'lower', compute: () => 0 },
          ],
        },
        [],
      ),
    ).toThrow(DuplicatedMetricName);
  });
});
