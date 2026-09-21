// Relación entre el plazo de la API (`MATCH_ANALYSIS_MAX_AGE_MS`) y el del worker
// (`MATCH_ANALYSIS_TIMEOUT_MS`): el de la API ha de ser **mayor** que el del worker contando todas las entregas
// que el trabajo pueda tener (ADR-030 §7, D12-bis). Si no, un análisis se leería `failed` mientras su ejecución
// todavía estuviera a tiempo, o un resultado tardío sobrescribiría lo que la persona ya vio como avería.
//
// `api` y `worker` invocan esto al arrancar con los mismos números: si solo uno lo comprueba, el otro puede
// arrancar con una pareja invertida y el fallo aparece en producción, no en el arranque.

/**
 * Entregas del trabajo de análisis: la cola `analyze-match` registra `attempts: 1` (ADR-030 §6). Reejecutar el
 * análisis entero multiplicaría los envíos del CV a un proveedor externo.
 */
export const MATCH_ANALYSIS_DELIVERIES = 1;

/**
 * Margen entre el plazo del worker y el de la API. Cubre el `lockDuration = timeout + 15 s` del consumidor: sin él,
 * el trabajo podría seguir vivo en BullMQ cuando la API ya lee el análisis como vencido.
 */
export const MATCH_ANALYSIS_DEADLINE_MARGIN_MS = 15_000;

export interface AnalysisDeadlinesInput {
  readonly maxAgeMs: number;
  readonly timeoutMs: number;
  readonly deliveries: number;
  readonly marginMs: number;
}

/**
 * Exige `maxAgeMs > timeoutMs * deliveries + marginMs`. Lanza con un mensaje que nombra las dos variables de
 * entorno y ambos valores, para que un operador sepa qué tocar sin adivinar.
 */
export function assertAnalysisDeadlines(input: AnalysisDeadlinesInput): void {
  const required =
    input.timeoutMs * input.deliveries + input.marginMs;
  if (input.maxAgeMs > required) {
    return;
  }

  throw new Error(
    `MATCH_ANALYSIS_MAX_AGE_MS (${String(input.maxAgeMs)}) must be greater than MATCH_ANALYSIS_TIMEOUT_MS (${String(input.timeoutMs)}) across ${String(input.deliveries)} delivery(ies) plus margin ${String(input.marginMs)} (need > ${String(required)})`,
  );
}
