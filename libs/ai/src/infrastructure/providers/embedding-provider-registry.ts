import type { EmbeddingProvider } from '../../domain/ports/embedding-provider.port';
import type { AiConfig, AiProviderId } from '../config/ai-config.schema';
import { MockEmbeddingProvider } from './mock-embedding.provider';
import { OllamaEmbeddingProvider } from './ollama-embedding.provider';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';
import { IncompleteProviderConfig } from './provider-registry';

// Construye la cadena `AI_EMBED_CHAIN` (ADR-036). Conserva el orden; timeouts para EmbedTexts.

export interface BuiltEmbeddingProviders {
  providers: readonly EmbeddingProvider[];
  timeoutsMs: Readonly<Record<string, number>>;
}

export type EmbeddingProviderConfig = Pick<
  AiConfig,
  | 'embedChain'
  | 'embedModel'
  | 'embedDimensions'
  | 'embedTimeoutMs'
  | 'mock'
  | 'ollama'
  | 'openrouter'
>;

export function buildEmbeddingProviders(
  config: EmbeddingProviderConfig,
): BuiltEmbeddingProviders {
  const providers: EmbeddingProvider[] = [];
  const timeoutsMs: Record<string, number> = {};

  for (const id of config.embedChain) {
    switch (id) {
      case 'mock': {
        const mock = config.mock ?? missing(id);
        providers.push(
          new MockEmbeddingProvider({
            mode: mock.mode,
            dimensions: config.embedDimensions,
          }),
        );
        break;
      }
      case 'ollama': {
        const ollama = config.ollama ?? missing(id);
        const provider = new OllamaEmbeddingProvider({
          baseUrl: ollama.baseUrl,
          model: config.embedModel,
          dimensions: config.embedDimensions,
        });
        providers.push(provider);
        timeoutsMs[provider.id] = config.embedTimeoutMs;
        break;
      }
      case 'openrouter': {
        const openrouter = config.openrouter ?? missing(id);
        const provider = new OpenRouterEmbeddingProvider({
          baseUrl: openrouter.baseUrl,
          apiKey: openrouter.apiKey,
          model: config.embedModel,
          dimensions: config.embedDimensions,
          referer: openrouter.referer,
          title: openrouter.title,
        });
        providers.push(provider);
        timeoutsMs[provider.id] = config.embedTimeoutMs;
        break;
      }
    }
  }

  return { providers, timeoutsMs };
}

function missing(id: AiProviderId): never {
  throw new IncompleteProviderConfig(id);
}
