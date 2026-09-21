// Resultado tipado de runTask (D2 de ai-gateway-core, ADR-018 §1; ampliado por D6 de cv-match-suggestions). Solo tipos.

/**
 * Motivos de degradación: cuatro y solo cuatro. El de consentimiento existe para no confundir «falta el permiso»
 * con «no hay IA» (ADR-030 §3).
 */
export type DegradedReason =
  | 'no_providers'
  | 'providers_failed'
  | 'quota_exceeded'
  | 'consent_required';

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
  /**
   * Instantáneo absoluto (ISO-8601 UTC) en que se podrá volver a intentar. Solo acompaña a `quota_exceeded`:
   * es el momento en que la ejecución contada más antigua sale de la ventana.
   */
  aiQuotaRetryAt?: string;
}

export type AiResult<O> = AiSuccess<O> | AiDegraded<O>;
