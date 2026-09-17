import type { MetricDirection } from '../evaluable-task';

// Tipos de métrica del eval harness (D5 de ai-eval-harness, ADR-019 §3).

/** `blocking`: entra en la línea base y bloquea en replay. `informational`: solo se reporta. */
export type MetricKind = 'blocking' | 'informational';

export interface MetricValue {
  name: string;
  kind: MetricKind;
  direction: MetricDirection;
  value: number;
}
