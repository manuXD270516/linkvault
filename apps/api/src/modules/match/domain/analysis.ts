import type {
  MatchDegradedReason,
  MatchFailureCode,
  MatchReport,
  MatchStep,
} from '@linkvault/shared';
import { MATCH_PROGRESS_STEPS } from '@linkvault/shared';

// Entidad del análisis de encaje (D1, D6, D12-ter; ADR-030 §5–§8). Aquí no hay framework ni base de datos: solo lo que
// un análisis es y las invariantes que nadie puede saltarse.
//
// Lo que el dominio **no** conoce: `cvText`, `jobText`, el prompt renderizado ni credenciales. El único texto del CV
// que puede vivir con el análisis es el `cvFragment` dentro del informe, acotado en el contrato compartido.

/** Estados persistidos. Un `running` vencido se **lee** como `failed` sin escribir (ver `expiry.ts`). */
export const MATCH_ANALYSIS_STATUSES = ['running', 'done', 'failed'] as const;
export type MatchAnalysisStatus = (typeof MATCH_ANALYSIS_STATUSES)[number];

/** Primer paso que deja escrito el `POST` al aceptar el trabajo. */
export const MATCH_ANALYSIS_INITIAL_STEP: MatchStep = MATCH_PROGRESS_STEPS[0];

/**
 * Análisis de encaje tal y como se guarda. Un `done` no lleva `failureCode`; un `failed` no lleva informe; todo
 * análisis terminado lleva `finishedAt` y `durationMs`.
 */
export interface MatchAnalysis {
  readonly id: string;
  readonly userId: string;
  readonly linkId: string;
  readonly cvId: string;
  readonly status: MatchAnalysisStatus;
  /** Último paso alcanzado; nunca retrocede. */
  readonly step: MatchStep;
  /** `previewVersion` de la oferta en el momento del análisis. */
  readonly previewVersion: number;
  /** Versión del prompt `match-cv` con la que se pidió o se resolvió. */
  readonly promptVersion: string;
  readonly provider?: string;
  readonly model?: string;
  /** Solo con `status: 'done'`. */
  readonly report?: MatchReport;
  /** Eco del informe cuando está degradado; ausente en `failed` y en `running`. */
  readonly degraded?: boolean;
  readonly degradedReason?: MatchDegradedReason;
  /** Solo con `status: 'failed'`. */
  readonly failureCode?: MatchFailureCode;
  /** Solo cuando degradó por cuota de IA agotada. */
  readonly aiQuotaRetryAt?: Date;
  /**
   * Si al ejecutar faltaba el permiso (o se resolvió sin él). Se guarda y se devuelve tal cual; el `GET` no lo
   * recalcula.
   */
  readonly consentRequired: boolean;
  /** `true` si el texto del CV salió a un proveedor externo. */
  readonly wentExternal: boolean;
  readonly requestedAt: Date;
  /** Presente en todo análisis terminado (`done` o `failed`). */
  readonly finishedAt?: Date;
  /** `finishedAt - requestedAt` en milisegundos, cuando terminó. */
  readonly durationMs?: number;
}

/** Alta en `running`: lo único que escribe la API (ADR-009, D2). */
export interface NewRunningAnalysis {
  readonly id: string;
  readonly userId: string;
  readonly linkId: string;
  readonly cvId: string;
  readonly previewVersion: number;
  readonly promptVersion: string;
  readonly requestedAt: Date;
}

/**
 * Construye el análisis en `running` con el primer paso. Sin informe, sin código de fallo, sin `finishedAt`.
 * `consentRequired` nace en `false`: lo decide el worker al ejecutar.
 */
export function createRunningAnalysis(
  params: NewRunningAnalysis,
): MatchAnalysis {
  return {
    id: params.id,
    userId: params.userId,
    linkId: params.linkId,
    cvId: params.cvId,
    status: 'running',
    step: MATCH_ANALYSIS_INITIAL_STEP,
    previewVersion: params.previewVersion,
    promptVersion: params.promptVersion,
    consentRequired: false,
    wentExternal: false,
    requestedAt: params.requestedAt,
  };
}

/**
 * Comprueba las invariantes de un análisis terminado o en curso. Devuelve el motivo del fallo o `undefined` si
 * encaja. Sirve a los unitarios y a quien mapee desde persistencia.
 */
export function analysisInvariantViolation(
  analysis: MatchAnalysis,
): string | undefined {
  if (analysis.status === 'running') {
    if (analysis.failureCode !== undefined) {
      return 'A running analysis must not carry a failure code';
    }
    if (analysis.report !== undefined) {
      return 'A running analysis must not carry a report';
    }
    if (analysis.finishedAt !== undefined || analysis.durationMs !== undefined) {
      return 'A running analysis must not carry finishedAt or durationMs';
    }
    return undefined;
  }

  if (analysis.finishedAt === undefined) {
    return 'A finished analysis must carry finishedAt';
  }
  if (analysis.durationMs === undefined) {
    return 'A finished analysis must carry durationMs';
  }

  if (analysis.status === 'done') {
    if (analysis.failureCode !== undefined) {
      return 'A done analysis must not carry a failure code';
    }
    if (analysis.report === undefined) {
      return 'A done analysis must carry its report';
    }
    return undefined;
  }

  // failed
  if (analysis.failureCode === undefined) {
    return 'A failed analysis must carry its failure code';
  }
  if (analysis.report !== undefined) {
    return 'A failed analysis must not carry a report';
  }
  return undefined;
}

/**
 * `true` si la oferta cambió después del análisis. Un análisis marcado así **se sigue devolviendo entero**: la marca
 * avisa; no oculta el informe.
 */
export function isStale(
  analysis: Pick<MatchAnalysis, 'previewVersion'>,
  currentPreviewVersion: number,
): boolean {
  return analysis.previewVersion !== currentPreviewVersion;
}

/**
 * `true` si el CV marcado por defecto ya no es el del análisis (incluido cuando ya no hay ninguno). Un análisis
 * marcado así **se sigue devolviendo entero**.
 */
export function isCvChanged(
  analysis: Pick<MatchAnalysis, 'cvId'>,
  defaultCvId: string | null | undefined,
): boolean {
  if (defaultCvId === null || defaultCvId === undefined) {
    return true;
  }
  return analysis.cvId !== defaultCvId;
}
