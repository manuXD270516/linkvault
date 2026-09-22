/**
 * Puerto de embeddings para search (ADR-036). Envuelve `embedTexts` de libs/ai.
 * En tests unitarios se inyecta stub; en runtime `adaptEmbedTexts(EMBED_TEXTS)`.
 */

export const SEARCH_EMBED_TEXTS = Symbol('SEARCH_EMBED_TEXTS');

export interface SearchEmbedContext {
  /** Dueño del agregado (indexación) o usuario que busca (query). */
  readonly userId: string;
  /** Sensibilidad: indexación y query usan `personal`. */
  readonly sensitivity: 'personal';
  readonly signal?: AbortSignal;
}

export interface SearchEmbedResult {
  readonly vectors: number[][];
  readonly model: string;
  readonly dimensions: number;
}

export type SearchEmbedTexts = (
  texts: readonly string[],
  ctx: SearchEmbedContext,
) => Promise<SearchEmbedResult>;
