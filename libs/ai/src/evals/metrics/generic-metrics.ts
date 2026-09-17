import type { CaseResult, MetricDirection } from '../evaluable-task';
import type { MetricKind, MetricValue } from './metric';

// Métricas genéricas de toda tarea evaluable (D5 de ai-eval-harness, requisito "Métricas"). Sobre un conjunto vacío
// valen 0; el cargador del golden no admite conjuntos vacíos.

type AnyCaseResult = CaseResult<unknown, unknown, unknown>;

interface GenericMetric {
  name: string;
  kind: MetricKind;
  direction: MetricDirection;
  compute(cases: readonly AnyCaseResult[]): number;
}

/** Casos con resultado `success` sobre casos ejecutados. */
export function schemaValidityRate(cases: readonly AnyCaseResult[]): number {
  return rate(cases, (c) => c.result.status === 'success');
}

/** Casos con resultado `degraded` (sin proveedores, proveedores fallidos o cuota) sobre casos ejecutados. */
export function degradedRate(cases: readonly AnyCaseResult[]): number {
  return rate(cases, (c) => c.result.status === 'degraded');
}

/** Mediana de la latencia en ms; con un número par de casos, media de los dos centrales. */
export function latencyP50(cases: readonly AnyCaseResult[]): number {
  return median(cases.map((c) => c.latencyMs));
}

/** Coste estimado medio por caso: suma de `estCost` de todos los registros del ledger de cada caso. */
export function costPerRun(cases: readonly AnyCaseResult[]): number {
  if (cases.length === 0) return 0;
  const total = cases.reduce((sum, c) => sum + c.usage.estCost, 0);
  return total / cases.length;
}

export const GENERIC_METRICS: readonly GenericMetric[] = [
  {
    name: 'schema_validity_rate',
    kind: 'blocking',
    direction: 'higher',
    compute: schemaValidityRate,
  },
  {
    name: 'degraded_rate',
    kind: 'blocking',
    direction: 'lower',
    compute: degradedRate,
  },
  {
    name: 'latency_p50',
    kind: 'informational',
    direction: 'lower',
    compute: latencyP50,
  },
  {
    name: 'cost_per_run',
    kind: 'informational',
    direction: 'lower',
    compute: costPerRun,
  },
];

export function computeGenericMetrics(
  cases: readonly AnyCaseResult[],
): MetricValue[] {
  return GENERIC_METRICS.map(({ name, kind, direction, compute }) => ({
    name,
    kind,
    direction,
    value: compute(cases),
  }));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function rate(
  cases: readonly AnyCaseResult[],
  predicate: (c: AnyCaseResult) => boolean,
): number {
  if (cases.length === 0) return 0;
  return cases.filter(predicate).length / cases.length;
}
