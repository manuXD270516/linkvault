// Contexto de una ejecución de runTask (D2 de ai-gateway-core, ADR-018 §3 y §11). Tipos y su valor por defecto.

/** Idioma de la salida de una tarea. `es` por defecto (design-v0.2 B16). */
export type OutputLanguage = 'es' | 'en';

export const DEFAULT_OUTPUT_LANGUAGE: OutputLanguage = 'es';

export interface AiConsent {
  /** Permite enviar tareas `personal` a proveedores con `external: true`. */
  externalProviders: boolean;
}

export interface RunContext {
  /** Ausente en ejecuciones de sistema: sin cuota. */
  userId?: string;
  /** Obligatorio y sin valor por defecto: quien llama decide explícitamente. */
  aiConsent: AiConsent;
  /** `es` si no se indica. Forma parte de la clave de ejecución y del prompt. */
  outputLanguage?: OutputLanguage;
  /** Redacta `personName` como `[NAME_1]` en tareas `personal` hacia proveedores externos. */
  redactName?: boolean;
  personName?: string;
  /** Plazo total de la ejecución. */
  signal?: AbortSignal;
}
