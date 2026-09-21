import type { MatchAnalysis } from './analysis';

// Vencimiento de un análisis en curso (D12-bis, ADR-030 §7 y §13). Es **solo lectura**: un `running` cuyo plazo
// (`MATCH_ANALYSIS_MAX_AGE_MS`) venció se presenta como `failed` con `internal_error`, sin escritura ni efecto
// secundario. El vencimiento es **terminal**: un resultado tardío no debe sobrescribir lo que la persona ya vio.

export type ExpiredAnalysisView = Omit<
  MatchAnalysis,
  'status' | 'step' | 'failureCode' | 'report' | 'finishedAt' | 'durationMs'
> & {
  readonly status: 'failed';
  readonly step: 'failed';
  readonly failureCode: 'internal_error';
  readonly finishedAt: Date;
  readonly durationMs: number;
  readonly report?: undefined;
};

/**
 * Instantánea en la que un `running` se considera terminado a efectos de orden y de cuota: `requestedAt + maxAgeMs`.
 * No se escribe; quien cuenta o ordena la deriva.
 */
export function effectiveFinishedAt(
  analysis: Pick<MatchAnalysis, 'status' | 'requestedAt' | 'finishedAt'>,
  maxAgeMs: number,
): Date | undefined {
  if (analysis.status === 'running') {
    return new Date(analysis.requestedAt.getTime() + maxAgeMs);
  }
  return analysis.finishedAt;
}

/**
 * `true` si un `running` ya pasó su plazo en `now`. Justo en el instante `requestedAt + maxAgeMs` **todavía** está en
 * curso; vence con el milisegundo siguiente. Un `done` o `failed` nunca está "vencido" en este sentido.
 */
export function isRunningExpired(
  analysis: Pick<MatchAnalysis, 'status' | 'requestedAt'>,
  maxAgeMs: number,
  now: Date,
): boolean {
  if (analysis.status !== 'running') {
    return false;
  }
  return now.getTime() > analysis.requestedAt.getTime() + maxAgeMs;
}

/**
 * Vista de lectura de un análisis: si es un `running` vencido, se presenta como `failed` con `internal_error` y
 * `finishedAt = requestedAt + maxAgeMs`. **No muta** el original. Dentro del plazo (incluido el instante exacto del
 * límite) o si ya terminó, se devuelve el mismo objeto.
 */
export function readAnalysis(
  analysis: MatchAnalysis,
  maxAgeMs: number,
  now: Date,
): MatchAnalysis | ExpiredAnalysisView {
  if (!isRunningExpired(analysis, maxAgeMs, now)) {
    return analysis;
  }

  const finishedAt = new Date(analysis.requestedAt.getTime() + maxAgeMs);
  return {
    id: analysis.id,
    userId: analysis.userId,
    linkId: analysis.linkId,
    cvId: analysis.cvId,
    status: 'failed',
    step: 'failed',
    previewVersion: analysis.previewVersion,
    promptVersion: analysis.promptVersion,
    ...(analysis.provider === undefined ? {} : { provider: analysis.provider }),
    ...(analysis.model === undefined ? {} : { model: analysis.model }),
    ...(analysis.degraded === undefined ? {} : { degraded: analysis.degraded }),
    ...(analysis.degradedReason === undefined
      ? {}
      : { degradedReason: analysis.degradedReason }),
    failureCode: 'internal_error',
    ...(analysis.aiQuotaRetryAt === undefined
      ? {}
      : { aiQuotaRetryAt: analysis.aiQuotaRetryAt }),
    consentRequired: analysis.consentRequired,
    wentExternal: analysis.wentExternal,
    requestedAt: analysis.requestedAt,
    finishedAt,
    durationMs: maxAgeMs,
  };
}
