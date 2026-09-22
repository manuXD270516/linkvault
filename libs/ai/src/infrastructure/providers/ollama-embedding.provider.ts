import { z } from 'zod';
import { ProviderUnavailable } from '../../domain/errors';
import type {
  EmbeddingCapabilities,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
} from '../../domain/ports/embedding-provider.port';
import { OLLAMA_PROVIDER_ID } from './ollama.provider';

// Adaptador Ollama embeddings por HTTP nativo, sin SDK (ADR-036 / D5). Usa `/api/embed`.

const HEALTH_TIMEOUT_MS = 5_000;

export interface OllamaEmbeddingProviderOptions {
  baseUrl: string;
  /** p. ej. `nomic-embed-text`. */
  model: string;
  dimensions: number;
}

const embedResponseSchema = z.object({
  model: z.string().optional(),
  embeddings: z.array(z.array(z.number())).min(1),
  prompt_eval_count: z.number().int().nonnegative().optional(),
});

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = OLLAMA_PROVIDER_ID;
  readonly capabilities: EmbeddingCapabilities;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(options: OllamaEmbeddingProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.capabilities = {
      embeddings: true,
      dimensions: options.dimensions,
      external: false,
      costPer1kTokens: 0,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const body = {
      model: this.model,
      input: [...req.texts],
    };

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch {
      throw this.failure(req.signal);
    }

    if (!response.ok) {
      await discardBody(response);
      throw new ProviderUnavailable(this.id, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw this.failure(req.signal);
    }
    const latencyMs = Math.round(performance.now() - startedAt);

    const parsed = embedResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderUnavailable(this.id);

    const vectors = parsed.data.embeddings;
    if (vectors.length !== req.texts.length) {
      throw new ProviderUnavailable(this.id);
    }
    for (const vector of vectors) {
      if (vector.length !== this.dimensions) {
        throw new ProviderUnavailable(this.id);
      }
    }

    return {
      vectors,
      model: parsed.data.model ?? this.model,
      dimensions: this.dimensions,
      usage: {
        inputTokens: parsed.data.prompt_eval_count ?? estimateTokens(req.texts),
      },
      latencyMs,
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      await discardBody(response);
      return response.ok;
    } catch {
      return false;
    }
  }

  private failure(signal: AbortSignal | undefined): unknown {
    return signal?.aborted ? signal.reason : new ProviderUnavailable(this.id);
  }
}

function estimateTokens(texts: readonly string[]): number {
  let chars = 0;
  for (const text of texts) chars += text.length;
  return Math.max(1, Math.ceil(chars / 4));
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // ignore
  }
}
