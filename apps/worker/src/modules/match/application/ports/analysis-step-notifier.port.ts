import type { AnalysisStepEvent } from '@linkvault/shared';

// Puerto del aviso de que un análisis cambió de paso (cv-suggestions-review, platform/realtime).
// El worker publica un aviso mínimo; `api` reparte por SSE solo al dueño. Fallar el aviso NUNCA tumba el análisis.

export const ANALYSIS_STEP_NOTIFIER = Symbol('ANALYSIS_STEP_NOTIFIER');

export interface AnalysisStepNotifier {
  /**
   * Publica el aviso. **Nunca lanza**: el paso ya está (o se intentó) en Mongo; no avisar solo significa que una
   * pantalla abierta se entera al sondear. Fallar el job por Redis caído reejecutaría el análisis entero.
   */
  publish(event: AnalysisStepEvent): Promise<void>;
}
