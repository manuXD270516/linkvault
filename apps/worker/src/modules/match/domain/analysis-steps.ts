import {
  MATCH_DEGRADED_SEQUENCE,
  MATCH_FINAL_STEPS,
  MATCH_FULL_SEQUENCE,
  isMatchFinalStep,
  type MatchStep,
} from '@linkvault/shared';

// Secuencias de pasos de una ejecución (tarea 13.1). El conjunto cerrado vive en `libs/shared`; aquí solo se arma
// cómo se recorre según el desenlace. **Siempre hay un final**: un análisis que no termina en `done`, `done-degraded`
// o `failed` es un bug de programación, no un estado válido.

/** Secuencia completa: con sugerencias hasta `done`. */
export const FULL_ANALYSIS_STEPS: readonly MatchStep[] = MATCH_FULL_SEQUENCE;

/**
 * Secuencia degradada: se salta `drafting-suggestions` por contrato y termina en `done-degraded`.
 */
export const DEGRADED_ANALYSIS_STEPS: readonly MatchStep[] =
  MATCH_DEGRADED_SEQUENCE;

/**
 * Secuencia fallida: el progreso que hubo y el final `failed`. El punto de corte depende de cuándo se aborta; la
 * constante fija el mínimo contractual —siempre acaba en `failed`.
 */
export const FAILED_ANALYSIS_STEPS: readonly MatchStep[] = [
  'reading-job',
  'failed',
] as const satisfies readonly MatchStep[];

/** Los tres finales que todo análisis debe alcanzar. */
export const ANALYSIS_FINAL_STEPS = MATCH_FINAL_STEPS;

/**
 * Comprueba que la secuencia termina en uno de los tres finales. Lanza si no: un análisis sin final dejaría la
 * pantalla contando una espera que nunca acaba.
 */
export function assertSequenceEndsWithFinal(
  steps: readonly MatchStep[],
): void {
  const last = steps[steps.length - 1];
  if (last === undefined || !isMatchFinalStep(last)) {
    throw new Error(
      `An analysis sequence must end in one of ${ANALYSIS_FINAL_STEPS.join(', ')}; got ${String(last)}`,
    );
  }
}

/** Secuencia contractual del desenlace. */
export function stepsForOutcome(
  outcome: 'full' | 'degraded' | 'failed',
): readonly MatchStep[] {
  switch (outcome) {
    case 'full':
      return FULL_ANALYSIS_STEPS;
    case 'degraded':
      return DEGRADED_ANALYSIS_STEPS;
    case 'failed':
      return FAILED_ANALYSIS_STEPS;
  }
}
