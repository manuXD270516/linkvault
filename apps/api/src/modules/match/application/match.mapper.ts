import type {
  MatchAnalysisResponse,
  MatchLatest,
  MatchReport,
  MatchRequestAccepted,
  MatchRunning,
} from '@linkvault/shared';
import { isCvChanged, isStale, type MatchAnalysis } from '../domain/analysis';

/** Cuerpo plano `202` del POST: identificadores y el paso inicial, sin informe. */
export function toMatchRequestAccepted(
  analysis: MatchAnalysis,
): MatchRequestAccepted {
  return {
    analysisId: analysis.id,
    linkId: analysis.linkId,
    cvId: analysis.cvId,
    status: 'running',
    step: analysis.step,
    requestedAt: analysis.requestedAt.toISOString(),
  };
}

/**
 * Compone el bloque `latest` del GET a partir de un análisis ya resuelto (o leído como vencido). `consentRequired` y
 * `aiQuotaRetryAt` salen **tal como quedaron guardados**; no se recalculan.
 */
export function toMatchLatest(
  analysis: MatchAnalysis,
  currentPreviewVersion: number,
  defaultCvId: string | null,
): MatchLatest {
  if (analysis.status !== 'done' && analysis.status !== 'failed') {
    throw new Error('toMatchLatest only accepts a resolved analysis');
  }
  if (analysis.finishedAt === undefined) {
    throw new Error('A resolved analysis must carry finishedAt');
  }

  const base = {
    analysisId: analysis.id,
    cvId: analysis.cvId,
    status: analysis.status,
    step: analysis.step,
    requestedAt: analysis.requestedAt.toISOString(),
    analyzedAt: analysis.finishedAt.toISOString(),
    stale: isStale(analysis, currentPreviewVersion),
    cvChanged: isCvChanged(analysis, defaultCvId),
    consentRequired: analysis.consentRequired,
  };

  if (analysis.status === 'failed') {
    return {
      ...base,
      status: 'failed',
      failureCode: analysis.failureCode ?? 'internal_error',
    };
  }

  const report = analysis.report as MatchReport;
  const quotaRetry =
    analysis.degraded === true &&
    analysis.degradedReason === 'quota_exceeded' &&
    analysis.aiQuotaRetryAt !== undefined;

  return {
    ...base,
    status: 'done',
    report,
    ...(quotaRetry
      ? { aiQuotaRetryAt: analysis.aiQuotaRetryAt.toISOString() }
      : {}),
  };
}

/** Bloque `running`: solo lo que existe mientras corre, más el plazo configurado. */
export function toMatchRunning(
  analysis: MatchAnalysis,
  maxAgeMs: number,
): MatchRunning {
  return {
    analysisId: analysis.id,
    cvId: analysis.cvId,
    status: 'running',
    step: analysis.step,
    requestedAt: analysis.requestedAt.toISOString(),
    maxAgeMs,
  };
}

export function toMatchAnalysisResponse(params: {
  readonly linkId: string;
  readonly latest: MatchAnalysis | null;
  readonly running: MatchAnalysis | null;
  readonly currentPreviewVersion: number;
  readonly defaultCvId: string | null;
  readonly maxAgeMs: number;
}): MatchAnalysisResponse {
  return {
    linkId: params.linkId,
    ...(params.latest !== null
      ? {
          latest: toMatchLatest(
            params.latest,
            params.currentPreviewVersion,
            params.defaultCvId,
          ),
        }
      : {}),
    ...(params.running !== null
      ? { running: toMatchRunning(params.running, params.maxAgeMs) }
      : {}),
  };
}
