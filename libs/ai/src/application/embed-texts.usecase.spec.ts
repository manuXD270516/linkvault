import { describe, expect, it } from 'vitest';
import {
  InMemoryAiLogger,
  InMemoryQuotaPolicy,
  InMemoryUsageLedger,
  ManualClock,
  RecordingNullCircuitBreaker,
} from './testing/in-memory-ports';
import { EmbedTexts } from './embed-texts.usecase';
import type { EmbeddingProvider } from '../domain/ports/embedding-provider.port';
import { MockEmbeddingProvider } from '../infrastructure/providers/mock-embedding.provider';
import { ProviderUnavailable } from '../domain/errors';

function harness(providers: readonly EmbeddingProvider[]) {
  const ledger = new InMemoryUsageLedger();
  const clock = new ManualClock();
  const logger = new InMemoryAiLogger();
  const breaker = new RecordingNullCircuitBreaker();
  const quota = new InMemoryQuotaPolicy();
  const embedTexts = new EmbedTexts({
    providers,
    ledger,
    quota,
    breaker,
    clock,
    logger,
  });
  return { embedTexts, ledger, logger, quota, breaker };
}

describe('embedTexts', () => {
  it('returns deterministic vectors via mock without going through runTask', async () => {
    const { embedTexts, ledger } = harness([
      new MockEmbeddingProvider({ mode: 'replay' }),
    ]);
    const result = await embedTexts.execute(['buscar TypeScript remoto'], {
      userId: 'ana',
      aiConsent: { externalProviders: false },
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.providerId).toBe('mock');
    expect(result.dimensions).toBe(768);
    expect(result.vectors[0]).toHaveLength(768);

    const again = await embedTexts.execute(['buscar TypeScript remoto'], {
      userId: 'ana',
      aiConsent: { externalProviders: false },
    });
    expect(again).toMatchObject({ status: 'success', vectors: result.vectors });

    expect(ledger.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: 'embed',
          outcome: 'success',
          userId: 'ana',
          providerId: 'mock',
        }),
      ]),
    );
    for (const row of ledger.records) {
      expect(JSON.stringify(row)).not.toContain('buscar TypeScript');
    }
  });

  it('redacts PII before an external embedding provider', async () => {
    const seen: string[][] = [];
    const external: EmbeddingProvider = {
      id: 'openrouter',
      capabilities: {
        embeddings: true,
        dimensions: 4,
        external: true,
        costPer1kTokens: 0,
      },
      embed: async (req) => {
        seen.push([...req.texts]);
        return {
          vectors: [req.texts.map((_, i) => i)],
          model: 'remote-embed',
          dimensions: 4,
          usage: { inputTokens: 3 },
          latencyMs: 1,
        };
      },
      healthy: () => Promise.resolve(true),
    };
    const { embedTexts } = harness([external]);
    const result = await embedTexts.execute(
      ['Contacta a ana@example.com para el CV'],
      {
        userId: 'ana',
        aiConsent: { externalProviders: true },
      },
    );
    expect(result.status).toBe('success');
    expect(seen[0]?.[0]).toContain('[EMAIL_1]');
    expect(seen[0]?.[0]).not.toContain('ana@example.com');
  });

  it('requires owner consent for external embed (indexation)', async () => {
    const external: EmbeddingProvider = {
      id: 'openrouter',
      capabilities: {
        embeddings: true,
        dimensions: 4,
        external: true,
        costPer1kTokens: 0,
      },
      embed: async () => {
        throw new Error('should not be called');
      },
      healthy: () => Promise.resolve(true),
    };
    const { embedTexts, ledger } = harness([external]);
    const result = await embedTexts.execute(['texto del CV de Ana'], {
      userId: 'ana',
      aiConsent: { externalProviders: false },
    });
    expect(result).toEqual({ status: 'degraded', reason: 'consent_required' });
    expect(ledger.records).toEqual([
      expect.objectContaining({
        task: 'embed',
        outcome: 'degraded',
        reason: 'consent_required',
        userId: 'ana',
      }),
    ]);
  });

  it('records provider_error in the ledger without the input text', async () => {
    const failing: EmbeddingProvider = {
      id: 'ollama',
      capabilities: {
        embeddings: true,
        dimensions: 4,
        external: false,
        costPer1kTokens: 0,
      },
      embed: async () => {
        throw new ProviderUnavailable('ollama', 500);
      },
      healthy: () => Promise.resolve(false),
    };
    const { embedTexts, ledger } = harness([failing]);
    const secret = 'secreto-cv-no-debe-aparecer';
    const result = await embedTexts.execute([secret], {
      userId: 'ana',
      aiConsent: { externalProviders: false },
    });
    expect(result).toEqual({ status: 'degraded', reason: 'providers_failed' });
    expect(ledger.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: 'embed',
          outcome: 'provider_error',
          providerId: 'ollama',
        }),
        expect.objectContaining({
          task: 'embed',
          outcome: 'degraded',
          reason: 'providers_failed',
        }),
      ]),
    );
    expect(JSON.stringify(ledger.records)).not.toContain(secret);
  });

  it('allows local provider without consent', async () => {
    const { embedTexts } = harness([
      new MockEmbeddingProvider({ mode: 'replay' }),
    ]);
    const result = await embedTexts.execute(['cv local'], {
      userId: 'ana',
      aiConsent: { externalProviders: false },
    });
    expect(result.status).toBe('success');
  });
});
