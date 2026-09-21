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
  /**
   * Proveedores a omitir de la cadena si queda al menos otro elegible (cv-suggestions-review / C19): el juez no
   * debe repetir al generador cuando hay dos opciones. Si excluir vaciara la cadena, se ignoran.
   */
  excludeProviderIds?: readonly string[];
  /**
   * Si true y hubo redacción hacia un proveedor externo: `output` conserva marcadores y la copia reinyectada
   * va en `reinjectedOutput` (ADR-031 / D10). El llamador reinyecta solo al persistir o responder al usuario.
   * Por defecto false: `output` ya viene reinyectado (comportamiento histórico).
   */
  deferPiiReinjection?: boolean;
}

/** Idioma de salida efectivo de una ejecución: el del contexto o `es`. */
export function outputLanguageOf(
  ctx: Pick<RunContext, 'outputLanguage'>,
): OutputLanguage {
  return ctx.outputLanguage ?? DEFAULT_OUTPUT_LANGUAGE;
}
