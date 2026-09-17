import type { ZodType } from 'zod';
import type { ProviderCapabilities } from './ports/llm-provider.port';

// Definición de una tarea de IA (design-v0.2 §4.2, ADR-014). Solo tipos: sin implementación.
// zod 4: ZodType<Output, Input = unknown>; se fija el tipo de salida validado.

export type AiTaskName =
  | 'extract-job'
  | 'match-cv'
  | 'critique-suggestions'
  | 'build-roadmap'
  | 'classify-skills';

export interface AiTask<I, O> {
  name: AiTaskName;
  /** p. ej. 'v1' */
  promptVersion: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  /** p. ej. { jsonMode: true, maxContextTokens: 16000 } */
  requires: Partial<ProviderCapabilities>;
  /** Tareas estructuradas: 0. */
  temperature: number;
  budget: { maxTokens: number; maxAttempts: number };
}
