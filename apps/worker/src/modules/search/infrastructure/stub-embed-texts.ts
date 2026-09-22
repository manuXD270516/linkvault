import { createHash } from 'node:crypto';
import type {
  SearchEmbedContext,
  SearchEmbedResult,
  SearchEmbedTexts,
} from '../application/ports/search-embed-texts.port';

export const STUB_EMBED_DIMENSIONS = 768;
export const STUB_EMBED_MODEL = 'stub-embed';

export function createStubEmbedTexts(options?: {
  readonly fail?: boolean;
}): SearchEmbedTexts {
  return async (
    texts: readonly string[],
    _ctx: SearchEmbedContext,
  ): Promise<SearchEmbedResult> => {
    if (options?.fail) {
      throw new Error('embedTexts unavailable');
    }
    return {
      vectors: texts.map((text) => vectorFor(text)),
      model: STUB_EMBED_MODEL,
      dimensions: STUB_EMBED_DIMENSIONS,
    };
  };
}

function vectorFor(text: string): number[] {
  const digest = createHash('sha256').update(text).digest();
  const out = new Array<number>(STUB_EMBED_DIMENSIONS);
  for (let i = 0; i < STUB_EMBED_DIMENSIONS; i += 1) {
    out[i] = (digest[i % digest.length]! / 255) * 2 - 1;
  }
  return out;
}
