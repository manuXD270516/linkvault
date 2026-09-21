import type {
  MatchDegradedReason,
  MatchFailureCode,
  MatchReport,
  MatchStep,
} from '@linkvault/shared';

// Forma del análisis que el worker lee y escribe. No importa el dominio de `api`: cada proceso tiene su vista
// (misma colección, mismas invariantes).

export type MatchAnalysisStatus = 'running' | 'done' | 'failed';

export interface MatchAnalysis {
  readonly id: string;
  readonly userId: string;
  readonly linkId: string;
  readonly cvId: string;
  readonly status: MatchAnalysisStatus;
  readonly step: MatchStep;
  readonly previewVersion: number;
  readonly promptVersion: string;
  readonly provider?: string;
  readonly model?: string;
  readonly report?: MatchReport;
  readonly degraded?: boolean;
  readonly degradedReason?: MatchDegradedReason;
  readonly failureCode?: MatchFailureCode;
  readonly aiQuotaRetryAt?: Date;
  readonly consentRequired: boolean;
  readonly wentExternal: boolean;
  readonly requestedAt: Date;
  readonly finishedAt?: Date;
  readonly durationMs?: number;
}

/** Resultado a persistir cuando el análisis termina en `done` (completo o degradado). */
export interface CompleteAnalysisInput {
  readonly step: 'done' | 'done-degraded';
  readonly report: MatchReport;
  readonly provider?: string;
  readonly model?: string;
  readonly promptVersion: string;
  readonly previewVersion: number;
  readonly degraded: boolean;
  readonly degradedReason?: MatchDegradedReason;
  readonly aiQuotaRetryAt?: Date;
  readonly consentRequired: boolean;
  readonly wentExternal: boolean;
  readonly finishedAt: Date;
  readonly durationMs: number;
}

/** Fallo de plataforma: solo `internal_error` en este change. */
export interface FailAnalysisInput {
  readonly failureCode: MatchFailureCode;
  readonly finishedAt: Date;
  readonly durationMs: number;
}
