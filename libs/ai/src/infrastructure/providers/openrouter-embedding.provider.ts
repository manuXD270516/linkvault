import { z } from 'zod';
import { ProviderUnavailable } from '../../domain/errors';
import type {
  EmbeddingCapabilities,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
} from '../../domain/ports/embedding-provider.port';
import { OPENROUTER_PROVIDER_ID } from './openrouter.provider';

// Adaptador OpenRouter embeddings (opcional en AI_EMBED_CHAIN; V0 default = mock+ollama). HTTP nativo, sin SDK.

const HEALTH_TIMEOUT_MS = 5_000;

export interface OpenRouterEmbeddingProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  referer: string;
  title: string;
}

const embeddingsResponseSchema = z.object({
  model: z.string().optional(),
  data: z
    .array(
      z.object({
        embedding: z.array(z.number()),
        index: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly id = OPENROUTER_PROVIDER_ID;
  readonly capabilities: EmbeddingCapabilities;
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly referer: string;
  private readonly title: string;

  constructor(options: OpenRouterEmbeddingProviderOptions) {
    this.#apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.referer = options.referer;
    this.title = options.title;
    this.capabilities = {
      embeddings: true,
      dimensions: options.dimensions,
      external: true,
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
      response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#apiKey}`,
          'HTTP-Referer': this.referer,
          'X-Title': this.title,
        },
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

    const parsed = embeddingsResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderUnavailable(this.id);

    const ordered = [...parsed.data.data].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const vectors = ordered.map((row) => row.embedding);
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
        inputTokens:
          parsed.data.usage?.prompt_tokens ??
          parsed.data.usage?.total_tokens ??
          estimateTokens(req.texts),
      },
      latencyMs,
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'HTTP-Referer': this.referer,
          'X-Title': this.title,
        },
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
