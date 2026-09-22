/**
 * Puerto de embeddings para search (ADR-036). Envuelve `embedTexts` de libs/ai.
 * Mientras el change `ai` aterriza en paralelo, los tests usan un stub/fake.
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
