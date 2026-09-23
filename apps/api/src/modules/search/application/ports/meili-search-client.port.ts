import type {
  SearchDocType,
  SearchMode,
} from '@linkvault/shared';

// Puerto del motor Meilisearch (change search, D2–D3 / D6). Solo tipos: el SDK vive en el adaptador.

export const MEILI_SEARCH_CLIENT = Symbol('MEILI_SEARCH_CLIENT');

export type SearchVisibilityScope = 'owner' | 'group' | 'owner_and_groups';

export type EmbeddingStatus = 'ready' | 'missing' | 'failed';

/** Documento unificado `lv_content` (D2). */
export interface SearchIndexDocument {
  readonly id: string;
  readonly docType: SearchDocType;
  readonly ownerUserId: string;
  readonly groupIds: readonly string[];
  readonly visibilityScope: SearchVisibilityScope;
  readonly updatedAt: number;
  readonly embeddingStatus: EmbeddingStatus;
  readonly embedModelId?: string;
  readonly embeddingDim?: number;
  /** Campos searchable / displayed (flat). */
  readonly title?: string;
  readonly company?: string;
  readonly description?: string;
  readonly skills?: readonly string[];
  readonly location?: string;
  readonly modality?: string;
  readonly salaryText?: string;
  /** Moneda de `preview.salary.currency` cuando es string no vacío (filterable). */
  readonly salaryCurrency?: string;
  /**
   * Extremos numéricos de `preview.salary.min` / `.max` (filterable, ADR-040).
   * `null` al limpiar para que Meili merge borre el valor previo.
   */
  readonly salaryMin?: number | null;
  readonly salaryMax?: number | null;
  readonly status?: string;
  readonly stageLabel?: string;
  readonly notes?: string;
  readonly body?: string;
  readonly note?: string;
  readonly text?: string;
  readonly stepsText?: string;
  readonly linkId?: string;
  readonly groupId?: string;
  readonly applicationId?: string;
  readonly cvId?: string;
  readonly roadmapId?: string;
  readonly analysisId?: string;
  /** ISO datetime when the vacancy is closed (ADR-037); absent when open. */
  readonly closedAt?: string;
  /** Vector nativo Meili (hybrid). Ausente si embeddingStatus ≠ ready. */
  readonly _vectors?: { readonly default: readonly number[] };
}

export interface MeiliSearchHit {
  readonly id: string;
  readonly docType: SearchDocType;
  readonly title?: string;
  readonly body?: string;
  readonly note?: string;
  readonly notes?: string;
  readonly text?: string;
  readonly description?: string;
  readonly score: number;
  readonly linkId?: string;
  readonly groupId?: string;
  readonly applicationId?: string;
  readonly cvId?: string;
  readonly roadmapId?: string;
  readonly analysisId?: string;
}

export interface MeiliSearchQuery {
  readonly q: string;
  readonly filter: string;
  readonly limit: number;
  readonly offset: number;
  readonly mode: SearchMode;
  readonly semanticRatio: number;
  readonly vector?: readonly number[];
}

export interface MeiliSearchResult {
  readonly hits: readonly MeiliSearchHit[];
  readonly estimatedTotal: number;
}

export interface MeiliSearchClient {
  /** `true` si el host está configurado (no implica healthy). */
  readonly configured: boolean;
  healthy(): Promise<boolean>;
  ensureIndex(): Promise<void>;
  upsert(documents: readonly SearchIndexDocument[]): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
  deleteByFilter(filter: string): Promise<void>;
  search(query: MeiliSearchQuery): Promise<MeiliSearchResult>;
}
