export const SEARCH_EMBED_TEXTS = Symbol('SEARCH_EMBED_TEXTS');

export interface SearchEmbedContext {
  readonly userId: string;
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
