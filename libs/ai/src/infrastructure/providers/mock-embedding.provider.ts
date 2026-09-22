import { createHash } from 'node:crypto';
import {
  MOCK_EMBEDDING_DIMENSIONS,
  type EmbeddingCapabilities,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
} from '../../domain/ports/embedding-provider.port';
import { MOCK_PROVIDER_ID } from '../../domain/provider-ids';
import type { AiMockMode } from '../config/ai-config.schema';
import { mulberry32, seedFromKey } from './mock-deterministic.provider';

// Mock determinista de embeddings (ADR-036 / D5). Mismo input canónico → mismo vector bit a bit.
// No depende de fixtures en disco: el vector se deriva del hash del texto (replay y synth).
// `synth` en producción lo impide `parseAiConfig` (igual que el mock LLM).

export const MOCK_EMBED_MODEL = 'mock-embed';

export interface MockEmbeddingProviderOptions {
  mode: AiMockMode;
  /** Dimensión fija; por defecto la de nomic-embed-text / mock (768). */
  dimensions?: number;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = MOCK_PROVIDER_ID;
  readonly capabilities: EmbeddingCapabilities;
  private readonly dimensions: number;

  constructor(options: MockEmbeddingProviderOptions) {
    this.dimensions = options.dimensions ?? MOCK_EMBEDDING_DIMENSIONS;
    this.capabilities = {
      embeddings: true,
      dimensions: this.dimensions,
      external: false,
      costPer1kTokens: 0,
    };
    // `mode` se conserva para alinear con AI_MOCK_MODE; ambos modos son hash-deterministas.
    void options.mode;
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    req.signal?.throwIfAborted();
    const texts = req.trace?.texts ?? req.texts;
    const vectors = texts.map((text) =>
      deterministicEmbedding(text, this.dimensions),
    );
    return {
      vectors,
      model: MOCK_EMBED_MODEL,
      dimensions: this.dimensions,
      usage: { inputTokens: estimateTokens(texts) },
      latencyMs: 0,
    };
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/**
 * Vector L2-normalizado determinista a partir de sha256(text). Semilla = primeros 8 hex del hash;
 * cada componente sale de mulberry32 → [-1, 1).
 */
export function deterministicEmbedding(
  text: string,
  dimensions: number = MOCK_EMBEDDING_DIMENSIONS,
): number[] {
  const key = createHash('sha256').update(text, 'utf8').digest('hex');
  const rng = mulberry32(seedFromKey(key));
  const raw = new Array<number>(dimensions);
  let normSq = 0;
  for (let i = 0; i < dimensions; i++) {
    const v = rng() * 2 - 1;
    raw[i] = v;
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq) || 1;
  return raw.map((v) => v / norm);
}

function estimateTokens(texts: readonly string[]): number {
  let chars = 0;
  for (const text of texts) chars += text.length;
  return Math.max(1, Math.ceil(chars / 4));
}
