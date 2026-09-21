import type { AnalysisStepMessage } from '@linkvault/shared';

// Puerto de salida hacia el navegador (cv-suggestions-review §6). `match` decide **a quién** (solo el dueño) y **qué**;
// cómo viaja hasta una pestaña abierta es del canal de eventos.

export const ANALYSIS_STEP_BROADCASTER = Symbol('ANALYSIS_STEP_BROADCASTER');

export interface AnalysisStepBroadcaster {
  /** `true` si hay alguna conexión abierta en este proceso. Sin ninguna, el aviso se descarta sin leer nada. */
  hasListeners(): boolean;
  /** Envía el mensaje a las conexiones abiertas de esa persona y dice a cuántas llegó. */
  send(userId: string, message: AnalysisStepMessage): number;
}
