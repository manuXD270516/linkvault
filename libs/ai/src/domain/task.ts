import type { ZodType } from 'zod';
import type { ProviderCapabilities } from './ports/llm-provider.port';

// Definición de una tarea de IA (design-v0.2 §4.2, ADR-014; ampliada por D2 de ai-gateway-core y ADR-018 §1, §4 y §11).
// Tipos y reglas puras: sin implementación de ejecución.
// zod 4: ZodType<Output, Input = unknown>; se fija el tipo de salida validado.

export type AiTaskName =
  | 'extract-job'
  | 'extract-pasted-job'
  | 'match-cv'
  | 'critique-suggestions'
  | 'build-roadmap'
  | 'classify-skills';

/** `personal`: redacción de PII y consentimiento para proveedores externos. `public`: contenido público. */
export type DataSensitivity = 'personal' | 'public';

export const DEFAULT_DATA_SENSITIVITY: DataSensitivity = 'personal';

/** Generador pseudoaleatorio determinista en [0, 1), sembrado con la clave de ejecución (D5). */
export type Rng = () => number;

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
  /** `maxAttempts` ∈ {1, 2}: 2 permite una reparación por proveedor (lo valida el registro de tareas). */
  budget: { maxTokens: number; maxAttempts: number };
  /** `personal` si no se declara (ADR-018 §11). */
  dataSensitivity?: DataSensitivity;
  /**
   * Si el resultado puede guardarse en la caché compartida. Una tarea `personal` NUNCA puede serlo: declararla
   * cacheable es un error de programación que impide el arranque (ADR-030 §cache).
   */
  cacheable: boolean;
  /** Salida honesta cuando la cadena se agota o está vacía; se valida contra `outputSchema`. */
  degrade?(input: I): O;
  /** Muestra determinista para el modo `synth` del mock; sin ella, `synth` lanza `SynthUnsupported`. */
  sample?(input: I, rng: Rng): O;
}

/** Sensibilidad efectiva de una tarea: `personal` por defecto. */
export function dataSensitivityOf(
  task: Pick<AiTask<unknown, unknown>, 'dataSensitivity'>,
): DataSensitivity {
  return task.dataSensitivity ?? DEFAULT_DATA_SENSITIVITY;
}
