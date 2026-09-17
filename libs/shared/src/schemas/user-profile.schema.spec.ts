import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_MAX_LENGTH,
  outputLanguageSchema,
  updateProfileRequestSchema,
  userProfileSchema,
} from './user-profile.schema';

describe('userProfileSchema', () => {
  const profile = {
    id: '66e9a0000000000000000001',
    email: 'ana@example.com',
    displayName: 'Ana',
    aiConsent: { externalProviders: false },
    outputLanguage: 'es',
    redactName: false,
    createdAt: '2026-09-17T10:00:00.000Z',
  } as const;

  it('accepts exactly the profile fields', () => {
    expect(userProfileSchema.parse(profile)).toEqual(profile);
  });

  it.each(['passwordHash', 'passwordChangedAt', 'emailNormalized'])(
    'rejects the extra field %s',
    (field) => {
      expect(
        userProfileSchema.safeParse({ ...profile, [field]: 'x' }).success,
      ).toBe(false);
    },
  );
});

describe('outputLanguageSchema', () => {
  it('accepts es and en only', () => {
    expect(outputLanguageSchema.options).toEqual(['es', 'en']);
  });
});

describe('updateProfileRequestSchema', () => {
  it('rejects an empty body', () => {
    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it.each([{ email: 'otro@example.com' }, { password: 'new-password-123' }])(
    'rejects the non-editable field in %j',
    (body) => {
      expect(updateProfileRequestSchema.safeParse(body).success).toBe(false);
    },
  );

  it('rejects an unknown field next to a valid one', () => {
    expect(
      updateProfileRequestSchema.safeParse({ displayName: 'Ana', role: 'x' })
        .success,
    ).toBe(false);
  });

  it('Idioma no soportado', () => {
    const result = updateProfileRequestSchema.safeParse({
      outputLanguage: 'fr',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      'outputLanguage',
    ]);
  });

  it('accepts a partial update and keeps only the sent fields', () => {
    expect(
      updateProfileRequestSchema.parse({
        aiConsent: { externalProviders: true },
      }),
    ).toEqual({ aiConsent: { externalProviders: true } });
  });

  it('rejects an aiConsent without externalProviders', () => {
    expect(
      updateProfileRequestSchema.safeParse({ aiConsent: {} }).success,
    ).toBe(false);
  });

  it.each([
    ['   ', false],
    [' Ana ', true],
    ['a'.repeat(DISPLAY_NAME_MAX_LENGTH), true],
    ['a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1), false],
  ])('displayName %j is valid: %s', (displayName, valid) => {
    expect(updateProfileRequestSchema.safeParse({ displayName }).success).toBe(
      valid,
    );
  });

  it('exposes the displayName limit', () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(60);
  });
});
