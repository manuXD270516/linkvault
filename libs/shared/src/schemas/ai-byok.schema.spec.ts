import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AI_BYOK_API_KEY_MIN_LENGTH,
  aiKeyViewSchema,
  aiVendorSchema,
  listAiKeysResponseSchema,
  upsertAiKeyRequestSchema,
} from './ai-byok.schema';

describe('ai-byok schemas', () => {
  it('accepts the three vendors', () => {
    expect(aiVendorSchema.options).toEqual([
      'anthropic',
      'openai',
      'openrouter',
    ]);
  });

  it('requires apiKey of at least 16 characters', () => {
    expect(
      upsertAiKeyRequestSchema.safeParse({
        apiKey: 'x'.repeat(AI_BYOK_API_KEY_MIN_LENGTH - 1),
      }).success,
    ).toBe(false);
    expect(
      upsertAiKeyRequestSchema.parse({
        apiKey: 'sk-test-key-123456',
      }),
    ).toEqual({ apiKey: 'sk-test-key-123456' });
  });

  it('accepts a key view and a list response', () => {
    const view = {
      vendor: 'openai' as const,
      keyHint: '3456',
      updatedAt: '2026-09-22T12:00:00.000Z',
    };
    expect(aiKeyViewSchema.parse(view)).toEqual(view);
    expect(listAiKeysResponseSchema.parse({ keys: [view] })).toEqual({
      keys: [view],
    });
  });

  it('rejects a keyHint that is not four characters', () => {
    expect(
      aiKeyViewSchema.safeParse({
        vendor: 'anthropic',
        keyHint: 'abc',
        updatedAt: '2026-09-22T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
