import type { OutputLanguage } from '../run-context';
import type { AiTaskName } from '../task';

// Registro de prompts versionados (design-v0.2 §4.6, D7 de ai-gateway-core). Solo tipos.

export interface PromptRef {
  taskName: AiTaskName;
  promptVersion: string;
}

/** Datos con los que se rellena la plantilla: el input validado (quizá redactado) y el idioma de salida. */
export interface PromptView {
  input: unknown;
  outputLanguage: OutputLanguage;
}

export interface RenderedPrompt {
  system: string;
  user: string;
}

export interface PromptRegistry {
  /**
   * Comprueba que existe el prompt de la versión declarada y que sus metadatos coinciden. Lanza un error que nombra
   * la tarea y la versión si no.
   */
  ensure(ref: PromptRef): Promise<void>;
  render(ref: PromptRef, view: PromptView): Promise<RenderedPrompt>;
}
