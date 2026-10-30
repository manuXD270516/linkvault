import { Counter, type Registry } from 'prom-client';
import { workerMetricsRegistry } from '../../../../infrastructure/metrics/worker-metrics-registry';
import type { CvFileFormat } from './child-command';

// Contador de lecturas de CV (D9 de cv-extract-isolation): un solo instrumento, con etiquetas de conjunto **cerrado**.
// Ninguna etiqueta lleva nombre de archivo, texto ni mensaje de error: solo el formato, el desenlace y la causa.

export const CV_EXTRACTIONS_METRIC = 'linkvault_cv_extractions_total';

export const CV_EXTRACTION_CAUSES = {
  text: ['none', 'pages_capped', 'raw_text_capped'],
  unreadable: [
    'parse_error',
    'password',
    'timeout',
    'heap_limit',
    'memory_ceiling',
    'child_exit',
    'input_budget',
    'protocol',
  ],
  machinery_error: ['boot_error', 'boot_timeout', 'protocol'],
} as const;

export type CvExtractionOutcome = keyof typeof CV_EXTRACTION_CAUSES;
export type CvExtractionCause<
  O extends CvExtractionOutcome = CvExtractionOutcome,
> = (typeof CV_EXTRACTION_CAUSES)[O][number];

export type CvExtractionCombination = {
  [O in CvExtractionOutcome]: {
    readonly outcome: O;
    readonly cause: CvExtractionCause<O>;
  };
}[CvExtractionOutcome];

export interface CvExtractionMetrics {
  record(format: CvFileFormat, combination: CvExtractionCombination): void;
}

const counters = new WeakMap<
  Registry,
  Counter<'format' | 'outcome' | 'cause'>
>();

function counterOf(
  registry: Registry,
): Counter<'format' | 'outcome' | 'cause'> {
  const existing = counters.get(registry);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Counter({
    name: CV_EXTRACTIONS_METRIC,
    help: 'CV reads by format, outcome and cause (closed label sets, no CV data).',
    labelNames: ['format', 'outcome', 'cause'] as const,
    registers: [registry],
  });
  counters.set(registry, created);
  return created;
}

/** Cuenta una lectura. Rechaza en ejecución una combinación fuera del conjunto cerrado. */
export class PrometheusCvExtractionMetrics implements CvExtractionMetrics {
  constructor(private readonly registry: Registry = workerMetricsRegistry) {
    counterOf(registry);
  }

  record(format: CvFileFormat, combination: CvExtractionCombination): void {
    const allowed: readonly string[] =
      CV_EXTRACTION_CAUSES[combination.outcome];
    if (!allowed.includes(combination.cause)) {
      throw new Error(
        `cv extraction metric: cause outside the closed set for ${combination.outcome}`,
      );
    }
    counterOf(this.registry).inc({
      format,
      outcome: combination.outcome,
      cause: combination.cause,
    });
  }
}
