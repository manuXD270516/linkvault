import { z, type ZodType } from 'zod';
import type {
  CompletionRequest,
  CompletionResult,
} from '../domain/ports/llm-provider.port';
import { extractJson } from './json-extraction';
import { findInventedPiiMarkers } from './pii-redactor';

// Pipeline de salida estructurada para UN proveedor (D3 de ai-gateway-core, design-v0.2 §4.3):
// completar → extracción tolerante → validación zod → marcadores inventados (D10) → como máximo una reparación
// (si maxAttempts = 2). No captura errores del proveedor: los decide runTask (fallback, FixtureMissing, breaker).

export interface StructuredOutputRequest<O> {
  /** Llamada al proveedor; runTask la envuelve (breaker, plazos). */
  complete: (request: CompletionRequest) => Promise<CompletionResult>;
  request: CompletionRequest;
  outputSchema: ZodType<O>;
  /** 1: sin reparación; 2: una reparación. */
  maxAttempts: number;
  /**
   * Marcadores emitidos en esta ejecución. Un marcador PII en la salida que no esté aquí la invalida (D10):
   * reparación, proveedor siguiente o degradación; nunca se devuelve ni se persiste.
   */
  emittedMarkers?: ReadonlySet<string>;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

interface PipelineMetrics {
  /** Modelo de la última respuesta recibida. */
  model: string;
  /** Tokens sumados de todas las respuestas recibidas (original y reparación). */
  usage: CompletionUsage;
  /** Número de peticiones de reparación enviadas (0 o 1). */
  repairs: number;
}

export type StructuredOutputResult<O> =
  | ({ status: 'valid'; output: O } & PipelineMetrics)
  | ({ status: 'invalid'; issues: readonly string[] } & PipelineMetrics);

/**
 * Error de proveedor durante el pipeline. Conserva el uso de las respuestas recibidas antes del fallo (p. ej. la
 * original cuando falla la reparación) para el ledger; `cause` es el error original.
 */
export class StructuredOutputProviderError extends Error {
  override readonly name = 'StructuredOutputProviderError';

  constructor(
    override readonly cause: unknown,
    readonly usage: CompletionUsage,
  ) {
    super('Provider call failed during structured output', { cause });
  }
}

type Validation<O> =
  | { ok: true; output: O }
  | { ok: false; issues: readonly string[]; feedback: string };

export async function runStructuredOutput<O>(
  params: StructuredOutputRequest<O>,
): Promise<StructuredOutputResult<O>> {
  const usage: CompletionUsage = { inputTokens: 0, outputTokens: 0 };

  const first = await call(params.complete, params.request, usage);
  const firstValidation = validate(
    first.text,
    params.outputSchema,
    params.emittedMarkers,
  );
  if (firstValidation.ok) {
    return valid(firstValidation.output, first.model, usage, 0);
  }
  if (params.maxAttempts < 2) {
    return invalid(firstValidation.issues, first.model, usage, 0);
  }

  const repairRequest: CompletionRequest = {
    ...params.request,
    user: repairUserMessage(
      params.request.user,
      first.text,
      firstValidation.feedback,
    ),
  };
  const second = await call(params.complete, repairRequest, usage);
  const secondValidation = validate(
    second.text,
    params.outputSchema,
    params.emittedMarkers,
  );
  return secondValidation.ok
    ? valid(secondValidation.output, second.model, usage, 1)
    : invalid(secondValidation.issues, second.model, usage, 1);
}

async function call(
  complete: StructuredOutputRequest<unknown>['complete'],
  request: CompletionRequest,
  usage: CompletionUsage,
): Promise<CompletionResult> {
  let result: CompletionResult;
  try {
    result = await complete(request);
  } catch (error) {
    throw new StructuredOutputProviderError(error, { ...usage });
  }
  usage.inputTokens += result.usage.inputTokens;
  usage.outputTokens += result.usage.outputTokens;
  return result;
}

function validate<O>(
  text: string,
  schema: ZodType<O>,
  emittedMarkers?: ReadonlySet<string>,
): Validation<O> {
  const extraction = extractJson(text);
  if (!extraction.ok) {
    const message = 'La respuesta no contiene un objeto JSON.';
    return { ok: false, issues: [message], feedback: message };
  }
  const parsed = schema.safeParse(extraction.value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
      feedback: z.prettifyError(parsed.error),
    };
  }
  if (emittedMarkers !== undefined) {
    const invented = findInventedPiiMarkers(parsed.data, emittedMarkers);
    if (invented.length > 0) {
      const message = `La respuesta contiene marcadores PII no emitidos: ${invented.join(', ')}.`;
      return { ok: false, issues: [message], feedback: message };
    }
  }
  return { ok: true, output: parsed.data };
}

/** Mensaje `user` compuesto de la reparación (D3): original, salida inválida y errores de validación. */
export function repairUserMessage(
  originalUser: string,
  invalidOutput: string,
  validationErrors: string,
): string {
  return [
    originalUser,
    '',
    '---',
    'Tu respuesta anterior no cumple el formato requerido.',
    '',
    'Respuesta anterior:',
    invalidOutput,
    '',
    'Errores de validación:',
    validationErrors,
    '',
    'Responde SOLO con el objeto JSON corregido, sin texto adicional.',
  ].join('\n');
}

function valid<O>(
  output: O,
  model: string,
  usage: CompletionUsage,
  repairs: number,
): StructuredOutputResult<O> {
  return { status: 'valid', output, model, usage: { ...usage }, repairs };
}

function invalid<O>(
  issues: readonly string[],
  model: string,
  usage: CompletionUsage,
  repairs: number,
): StructuredOutputResult<O> {
  return { status: 'invalid', issues, model, usage: { ...usage }, repairs };
}
