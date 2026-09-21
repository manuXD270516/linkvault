import type { ZodType } from 'zod';
import type { AiResult } from '../domain/ai-result';
import type { UsageOutcome } from '../domain/ports/usage-ledger.port';
import type { OutputLanguage } from '../domain/run-context';
import type { AiTask } from '../domain/task';

// Contrato de tarea evaluable (D4 de ai-eval-harness, ADR-019 §2): la tarea de IA, el schema de `expected` de sus casos
// y sus métricas propias, calculadas sobre el conjunto completo de resultados.

/** Dirección en la que una métrica mejora. */
export type MetricDirection = 'higher' | 'lower';

/** Caso del golden set ya validado (D4). */
/** Tipo de PII anotado en el golden (alineado con `PiiKind` en minúsculas). */
export type GoldenPiiType =
  | 'email'
  | 'phone'
  | 'url'
  | 'name'
  | 'address'
  | 'id';

/** Anotación de un valor de PII presente en el `input` del caso. */
export interface GoldenPiiAnnotation {
  type: GoldenPiiType;
  value: string;
  /** Identificador del hueco conocido declarado fuera del golden (`known-gaps.json`). */
  knownGap?: string;
}

export interface GoldenCase<I, E> {
  /** Número de línea (desde 1) en `golden.jsonl`. */
  line: number;
  id: string;
  /** Input parseado por `task.inputSchema`. */
  input: I;
  /** `expected` parseado por `expectedSchema`. */
  expected: E;
  tags: readonly string[];
  outputLanguage?: OutputLanguage;
  /** Clave de ejecución del caso (ADR-018 §3), con `outputLanguage` del caso o `es`. */
  key: string;
  /** Valores de PII inventados presentes en el input (métricas de redacción). */
  pii?: readonly GoldenPiiAnnotation[];
  /**
   * Términos que la redacción no debe ocultar: habilidades, topónimos y nombres de empleador
   * (`redaction_skill_loss`).
   */
  skills?: readonly string[];
  /** Nombre que el contexto de redacción usa cuando el caso anota PII de `type: name`. */
  personName?: string;
  /**
   * Etiqueta humana 1–5 del encaje (cv-suggestions-review / design §4.11). Ausente = el caso no entra
   * en `score_label_correlation`.
   */
  humanLabel?: 1 | 2 | 3 | 4 | 5;
}

/** Coste de una vuelta del bucle (generador, juez, revisión…), en orden de escritura del ledger. */
export interface RoundCost {
  /** Índice desde 0. */
  round: number;
  task: string;
  estCost: number;
  latencyMs: number;
}

/** Uso acumulado de todos los registros del ledger de la clave del caso (D3). */
export interface CaseUsage {
  inputTokens: number;
  outputTokens: number;
  estCost: number;
  /** Resultados de cada registro, en orden de escritura (p. ej. `provider_error`, `degraded`). */
  outcomes: readonly UsageOutcome[];
  /** Una entrada por registro del ledger (vuelta del bucle o intento). */
  rounds: readonly RoundCost[];
}

/** Resultado de ejecutar un caso con `runTask`. */
export interface CaseResult<I, O, E> {
  goldenCase: GoldenCase<I, E>;
  result: AiResult<O>;
  /** Medida alrededor de `execute` (D3). */
  latencyMs: number;
  usage: CaseUsage;
}

/** Métrica propia de una tarea: siempre bloqueante (spec "Métricas", ADR-019 §3). */
export interface TaskMetric<I, O, E> {
  name: string;
  direction: MetricDirection;
  compute(cases: readonly CaseResult<I, O, E>[]): number;
}

/**
 * Columna propia de la tabla por caso del reporte (D6), p. ej. skills faltantes. Nunca debe devolver el input ni la
 * salida completa.
 */
export interface CaseColumn<I, O, E> {
  header: string;
  value(result: CaseResult<I, O, E>): string;
}

export interface EvaluableTask<I, O, E> {
  task: AiTask<I, O>;
  expectedSchema: ZodType<E>;
  metrics: readonly TaskMetric<I, O, E>[];
  /** Columnas del reporte por caso tras las genéricas (id, tags, estado, latencia). */
  caseColumns?: readonly CaseColumn<I, O, E>[];
  /**
   * Golden de CVs personales (ADR-030 §2/§14): exige `anonymized` en cada caso, al menos un
   * `name-collision` y cruza marcas `knownGap` con `known-gaps.json`.
   */
  personalCvGolden?: boolean;
}

export type AnyEvaluableTask = EvaluableTask<unknown, unknown, unknown>;

/** Borra los parámetros de tipo para guardar tareas heterogéneas en un registro. */
export function eraseEvaluableTask<I, O, E>(
  evaluable: EvaluableTask<I, O, E>,
): AnyEvaluableTask {
  return evaluable as unknown as AnyEvaluableTask;
}
