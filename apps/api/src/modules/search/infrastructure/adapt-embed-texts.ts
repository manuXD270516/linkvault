import type { EmbedTextsFn } from '@linkvault/ai';
import type {
  SearchEmbedTexts,
} from '../application/ports/search-embed-texts.port';
import type { SearchAiConsent } from '../application/ports/search-ai-consent.port';

/**
 * Adapta `EMBED_TEXTS` (libs/ai) al puerto search (ADR-036 / C5).
 * Degradación → throw para que query/index reutilicen sus catch (`degraded` / `embeddingStatus: failed`).
 */
export function adaptEmbedTexts(
  embedTexts: EmbedTextsFn,
  consent: SearchAiConsent,
): SearchEmbedTexts {
  return async (texts, ctx) => {
    const aiConsent = await consent.of(ctx.userId);
    const result = await embedTexts([...texts], {
      userId: ctx.userId,
      aiConsent,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    });
    if (result.status !== 'success') {
      throw new Error(`embedTexts degraded: ${result.reason}`);
    }
    return {
      vectors: result.vectors,
      model: result.model,
      dimensions: result.dimensions,
    };
  };
}
