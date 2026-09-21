import type { RunTaskFn } from '../../application/run-task.usecase';
import type { AiResult } from '../../domain/ai-result';
import { AiProgrammingError } from '../../domain/errors';
import type { Clock } from '../../domain/ports/clock.port';
import { outputLanguageOf, type RunContext } from '../../domain/run-context';
import type {
  CaseResult,
  CaseUsage,
  EvaluableTask,
  GoldenCase,
} from '../evaluable-task';
import type { EvalUsageLedger } from './eval-ports';

// Ejecución de los casos de un golden set (D3 de ai-eval-harness, requisito "Corredor de evaluación"): en secuencia y en
// orden de archivo, con contexto por defecto, latencia alrededor de cada `execute` y suma de todos los registros del
// ledger de la clave del caso. Degradados y fallos de proveedor se cuentan; un error de programación detiene la evaluación.

/**
 * Error de programación durante un caso (`AiProgrammingError`, p. ej. `FixtureMissing`): nombra el `id` del caso y su
 * clave y envuelve al original en `cause`. El CLI lo traduce a código 3.
 */
export class EvalCaseProgrammingError extends Error {
  override readonly name = 'EvalCaseProgrammingError';

  constructor(
    readonly taskName: string,
    readonly caseId: string,
    readonly key: string,
    override readonly cause: AiProgrammingError,
  ) {
    super(
      `Case "${caseId}" of task ${taskName} (execution key ${key}) stopped the evaluation: ${cause.name}: ${cause.message}`,
      { cause },
    );
  }
}

export interface RunCasesOptions<I, O, E> {
  evaluable: EvaluableTask<I, O, E>;
  cases: readonly GoldenCase<I, E>[];
  runTask: RunTaskFn;
  /** El ledger que recibe `runTask`: de él salen tokens, coste y resultados por caso. */
  ledger: EvalUsageLedger;
  clock: Clock;
}

/** Contexto de cada caso (D3): sin usuario, consentimiento externo y el idioma del caso o `es`. */
export function caseContext(
  goldenCase: GoldenCase<unknown, unknown>,
): RunContext {
  return {
    aiConsent: { externalProviders: true },
    outputLanguage: outputLanguageOf(goldenCase),
  };
}

export async function runCases<I, O, E>(
  options: RunCasesOptions<I, O, E>,
): Promise<CaseResult<I, O, E>[]> {
  const { evaluable, runTask, ledger, clock } = options;
  const results: CaseResult<I, O, E>[] = [];

  for (const goldenCase of options.cases) {
    ledger.drain();
    const startedAt = clock.now();
    let result: AiResult<O>;
    try {
      result = await runTask(
        evaluable.task,
        goldenCase.input,
        caseContext(goldenCase),
      );
    } catch (error) {
      ledger.drain();
      if (error instanceof AiProgrammingError) {
        throw new EvalCaseProgrammingError(
          evaluable.task.name,
          goldenCase.id,
          goldenCase.key,
          error,
        );
      }
      throw error;
    }
    const latencyMs = clock.now() - startedAt;

    // `runTask` registra de forma síncrona antes de resolver: aquí ya están todos los registros del caso.
    results.push({
      goldenCase,
      result,
      latencyMs,
      usage: sumUsage(ledger.drain()),
    });
  }
  return results;
}

export interface CaseCounts {
  total: number;
  success: number;
  degraded: number;
  /** Registros `provider_error` de todos los casos (un caso puede tener varios o ninguno). */
  providerErrors: number;
  schemaErrors: number;
}

export function countCases(
  results: readonly CaseResult<unknown, unknown, unknown>[],
): CaseCounts {
  const outcomes = results.flatMap((r) => r.usage.outcomes);
  return {
    total: results.length,
    success: results.filter((r) => r.result.status === 'success').length,
    degraded: results.filter((r) => r.result.status === 'degraded').length,
    providerErrors: outcomes.filter((o) => o === 'provider_error').length,
    schemaErrors: outcomes.filter((o) => o === 'schema_error').length,
  };
}

function sumUsage(records: ReturnType<EvalUsageLedger['take']>): CaseUsage {
  return {
    inputTokens: records.reduce((sum, r) => sum + r.inputTokens, 0),
    outputTokens: records.reduce((sum, r) => sum + r.outputTokens, 0),
    estCost: records.reduce((sum, r) => sum + r.estCost, 0),
    outcomes: records.map((r) => r.outcome),
    rounds: records.map((r, index) => ({
      round: index,
      task: r.task,
      estCost: r.estCost,
      latencyMs: r.latencyMs,
    })),
  };
}
