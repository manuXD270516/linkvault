import { describe, expect, it } from 'vitest';
import {
  MOCK_EMBEDDING_DIMENSIONS,
  type EmbedRequest,
} from '../../domain/ports/embedding-provider.port';
import {
  deterministicEmbedding,
  MockEmbeddingProvider,
} from './mock-embedding.provider';

describe('MockEmbeddingProvider', () => {
  it('mismo input → mismo vector (replay)', async () => {
    const provider = new MockEmbeddingProvider({ mode: 'replay' });
    const req: EmbedRequest = {
      texts: ['CV de Ana Pérez con TypeScript'],
      trace: {
        operation: 'embed',
        key: 'abc',
        texts: ['CV de Ana Pérez con TypeScript'],
      },
    };
    const a = await provider.embed(req);
    const b = await provider.embed(req);
    expect(a.vectors).toEqual(b.vectors);
    expect(a.vectors[0]).toHaveLength(MOCK_EMBEDDING_DIMENSIONS);
    expect(a.dimensions).toBe(768);
    expect(a.model).toBe('mock-embed');
  });

  it('distinto input → distinto vector', async () => {
    const provider = new MockEmbeddingProvider({ mode: 'replay' });
    const a = await provider.embed({ texts: ['alpha'] });
    const b = await provider.embed({ texts: ['beta'] });
    expect(a.vectors[0]).not.toEqual(b.vectors[0]);
  });

  it('deterministicEmbedding is L2-normalized and stable', () => {
    const v = deterministicEmbedding('hello', 8);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
    expect(v).toEqual(deterministicEmbedding('hello', 8));
  });

  it('declares local embeddings capabilities', () => {
    const provider = new MockEmbeddingProvider({ mode: 'synth' });
    expect(provider.capabilities).toEqual({
      embeddings: true,
      dimensions: 768,
      external: false,
      costPer1kTokens: 0,
    });
  });
});
