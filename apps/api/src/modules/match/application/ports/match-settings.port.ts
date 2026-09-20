// Ajustes del análisis que el caso de uso necesita: plazos, cuota y versión de prompt. El adaptador de producción los
// toma de `APP_CONFIG` y de `matchCvTask.promptVersion`.

export const MATCH_ANALYSIS_SETTINGS = Symbol('MATCH_ANALYSIS_SETTINGS');

export interface MatchAnalysisSettings {
  /** Plazo (ms) tras el cual un `running` se lee `failed`; el mismo que publica el `GET` en `running.maxAgeMs`. */
  readonly maxAgeMs: number;
  /** Ventana (ms) de la cuota de análisis por persona. */
  readonly quotaWindowMs: number;
  /** Tope de análisis con informe no degradado dentro de la ventana. */
  readonly analysesPerUser: number;
  /** Versión del prompt `match-cv` con la que se pide o se reutiliza. */
  readonly promptVersion: string;
}
