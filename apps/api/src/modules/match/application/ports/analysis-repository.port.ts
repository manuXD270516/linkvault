import type { MatchDegradedReason, MatchReport } from '@linkvault/shared';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';
import type { MatchAnalysis } from '../../domain/analysis';

// Puerto de persistencia del análisis (D2, D12-ter; ADR-030 §4, §7, §8). Se inyecta con
// `{ provide: ANALYSIS_REPOSITORY, useClass: MongoAnalysisRepository }`.
//
// **La única escritura en la API** es `createRunning` (documento + `MatchRequested.v1` en la misma transacción). Completar
// o fallar vive en el worker. **No hay contador ni límite aparte**: la cuota se deriva con `countForQuota`.

export const ANALYSIS_REPOSITORY = Symbol('ANALYSIS_REPOSITORY');

/** Alta en `running` con el primer paso; el adaptador escribe también el evento del outbox. */
export interface CreateRunningAnalysisInput {
  readonly id: string;
  readonly userId: string;
  readonly linkId: string;
  readonly cvId: string;
  readonly previewVersion: number;
  readonly promptVersion: string;
  readonly requestedAt: Date;
}

/** El más antiguo de los análisis que cuentan para la cuota, y por qué cuenta. */
export type QuotaOldest =
  | { readonly kind: 'finished'; readonly at: Date }
  | { readonly kind: 'running'; readonly at: Date };

export interface QuotaCount {
  readonly count: number;
  /** Ausente cuando `count` es 0. De él sale el `Retry-After`. */
  readonly oldest?: QuotaOldest;
}

/** Score + marca del último `done` por link (D11: deriva `fitScore` al leer). */
export interface AnalysisFitScore {
  readonly score: number;
  readonly degraded: boolean;
}

/** Degradado reutilizable: lo guardado basta para decidir vigencia en 9.6. */
export interface ReusableDegradedAnalysis {
  readonly analysis: MatchAnalysis;
  readonly degradedReason: MatchDegradedReason;
  readonly aiQuotaRetryAt?: Date;
  readonly report: MatchReport;
}

export interface AnalysisRepository {
  /** Identificador del análisis antes de insertarlo: quien sabe qué forma tiene es quien lo persiste. */
  nextId(): string;

  /**
   * Inserta el análisis en `running` con su primer paso y hace `append` de `MatchRequested.v1` **en la misma
   * transacción** (ADR-009). Es la **única** escritura de análisis que vive en la API.
   */
  createRunning(input: CreateRunningAnalysisInput): Promise<MatchAnalysis>;

  /**
   * El de **fecha de finalización más reciente** entre los `done`, los `failed` y los `running` ya vencidos, con el CV
   * que fuera. La fecha de un vencido se deriva de `requestedAt + maxAgeMs`. Devuelve la vista de lectura (un vencido
   * aparece como `failed` con `internal_error`) sin escribir.
   */
  findLatestResolved(
    userId: string,
    linkId: string,
    maxAgeMs: number,
    now: Date,
  ): Promise<MatchAnalysis | null>;

  /**
   * El `running` dentro de plazo de `requestedAt` más reciente. Un vencido no aparece aquí.
   */
  findRunning(
    userId: string,
    linkId: string,
    maxAgeMs: number,
    now: Date,
  ): Promise<MatchAnalysis | null>;

  /**
   * `done` **no degradado**, mismo CV, misma `previewVersion` y misma versión de prompt. Un `failed` o un vencido no
   * cuentan.
   */
  findReusable(
    userId: string,
    linkId: string,
    cvId: string,
    previewVersion: number,
    promptVersion: string,
  ): Promise<MatchAnalysis | null>;

  /**
   * El último `done` degradado del mismo trío, con su `degradedReason` y su `aiQuotaRetryAt`, para que 9.6 decida.
   */
  findReusableDegraded(
    userId: string,
    linkId: string,
    cvId: string,
    previewVersion: number,
    promptVersion: string,
  ): Promise<ReusableDegradedAnalysis | null>;

  /**
   * **Una sola consulta**: cuántos análisis de esa persona cuentan —`done` no degradados cuya `finishedAt` cae en la
   * ventana, más `running` dentro de su plazo— y la fecha del más antiguo de los contados con su naturaleza.
   */
  countForQuota(
    userId: string,
    windowMs: number,
    maxAgeMs: number,
    now: Date,
  ): Promise<QuotaCount>;

  /**
   * Borra los análisis hechos con ese CV —incluidos sus fragmentos de evidencia— **dentro de la sesión** que se les
   * pasa. Devuelve cuántos documentos se eliminaron.
   */
  removeByCv(
    userId: string,
    cvId: string,
    session: TransactionSession,
  ): Promise<number>;

  /**
   * Recuento por `cvId` de los análisis de esa persona, **sin traer ningún documento**. Incluye los que no terminaron.
   */
  countByCv(userId: string): Promise<ReadonlyMap<string, number>>;

  /**
   * Por lote: para cada `linkId`, el `score` y la marca de degradado del **último** análisis `done` por `finishedAt`.
   * Los `failed`, `running` y vencidos no cuentan. Un link sin `done` no aparece en el mapa.
   */
  findLatestDoneFitScores(
    userId: string,
    linkIds: readonly string[],
  ): Promise<ReadonlyMap<string, AnalysisFitScore>>;
}
