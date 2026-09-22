import { describe, expect, it, vi } from 'vitest';
import type { EmbedTextsFn } from '@linkvault/ai';
import { adaptEmbedTexts } from './adapt-embed-texts';

describe('adaptEmbedTexts', () => {
  it('maps success to SearchEmbedResult with owner consent', async () => {
    const embedTexts: EmbedTextsFn = vi.fn(async () => ({
      status: 'success' as const,
      vectors: [[0.1, 0.2]],
      providerId: 'mock',
      model: 'mock-embed',
      dimensions: 2,
    }));
    const consent = {
      of: vi.fn(async () => ({ externalProviders: false })),
    };
    const adapted = adaptEmbedTexts(embedTexts, consent);
    const result = await adapted(['hola'], {
      userId: 'ana',
      sensitivity: 'personal',
    });
    expect(result).toEqual({
      vectors: [[0.1, 0.2]],
      model: 'mock-embed',
      dimensions: 2,
    });
    expect(consent.of).toHaveBeenCalledWith('ana');
    expect(embedTexts).toHaveBeenCalledWith(['hola'], {
      userId: 'ana',
      aiConsent: { externalProviders: false },
    });
  });

  it('throws when embedTexts returns degraded', async () => {
    const embedTexts: EmbedTextsFn = vi.fn(async () => ({
      status: 'degraded' as const,
      reason: 'providers_failed' as const,
    }));
    const adapted = adaptEmbedTexts(embedTexts, {
      of: async () => ({ externalProviders: false }),
    });
    await expect(
      adapted(['q'], { userId: 'u1', sensitivity: 'personal' }),
    ).rejects.toThrow(/degraded/);
  });
});
