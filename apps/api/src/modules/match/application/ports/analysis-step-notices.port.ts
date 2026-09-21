import type { AnalysisStepPayload } from '@linkvault/shared';

// Puerto del canal por el que llegan los avisos de paso de análisis (cv-suggestions-review, platform/realtime).
// El worker publica AnalysisStep.v1; `api` reparte solo al dueño. Solo tipos y el token.

export const ANALYSIS_STEP_NOTICES = Symbol('ANALYSIS_STEP_NOTICES');

export interface AnalysisStepNotices {
  /**
   * Escucha los avisos. Una suscripción por proceso: cada instancia de `api` reparte a sus propias conexiones.
   * Devuelve cómo dejar de escuchar. Un aviso que no cumple su contrato se descarta sin tocar nada.
   */
  subscribe(
    handler: (payload: AnalysisStepPayload) => Promise<void>,
  ): Promise<() => Promise<void>>;
}
