// Resultado tipado de runTask (D2 de ai-gateway-core, ADR-018 §1). Solo tipos.

export type DegradedReason =
  'no_providers' | 'providers_failed' | 'quota_exceeded';

export interface AiSuccess<O> {
  status: 'success';
  output: O;
  providerId: string;
  model: string;
  promptVersion: string;
  cached: boolean;
}

export interface AiDegraded<O> {
  status: 'degraded';
  reason: DegradedReason;
  /** Salida de `task.degrade(input)`, validada; ausente si la tarea no declara degradación. */
  output?: O;
}

export type AiResult<O> = AiSuccess<O> | AiDegraded<O>;
