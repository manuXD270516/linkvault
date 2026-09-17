import type { CaseResult, EvaluableTask } from '../evaluable-task';
import { computeGenericMetrics } from './generic-metrics';
import type { MetricValue } from './metric';

// Agregación de métricas de una evaluación (D5 de ai-eval-harness): genéricas y, detrás, las propias de la tarea, que
// son siempre bloqueantes (ADR-019 §3).

export class DuplicatedMetricName extends Error {
  override readonly name = 'DuplicatedMetricName';

  constructor(
    readonly taskName: string,
    readonly metricName: string,
  ) {
    super(`Task ${taskName} declares metric "${metricName}" more than once`);
  }
}

export function computeMetrics<I, O, E>(
  evaluable: EvaluableTask<I, O, E>,
  cases: readonly CaseResult<I, O, E>[],
): MetricValue[] {
  const generic = computeGenericMetrics(
    cases as readonly CaseResult<unknown, unknown, unknown>[],
  );
  const own: MetricValue[] = evaluable.metrics.map((metric) => ({
    name: metric.name,
    kind: 'blocking',
    direction: metric.direction,
    value: metric.compute(cases),
  }));
  const all = [...generic, ...own];

  const seen = new Set<string>();
  for (const { name } of all) {
    if (seen.has(name)) {
      throw new DuplicatedMetricName(evaluable.task.name, name);
    }
    seen.add(name);
  }
  return all;
}
