import { describe, expect, it } from 'vitest';
import { AI_CONSENT_TEXT_VERSION } from '../consent/ai-consent-text';
import {
  DISPLAY_NAME_MAX_LENGTH,
  deleteAccountRequestSchema,
  isAiConsentCurrent,
  outputLanguageSchema,
  updateProfileRequestSchema,
  userProfileSchema,
} from './user-profile.schema';

describe('userProfileSchema', () => {
  const profile = {
    id: '66e9a0000000000000000001',
    email: 'ana@example.com',
    displayName: 'Ana',
    aiConsent: {
      externalProviders: false,
      consentedAt: null,
      textVersion: null,
      currentTextVersion: AI_CONSENT_TEXT_VERSION,
    },
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

  it('sigue siendo estricto en aiConsent', () => {
    expect(
      userProfileSchema.safeParse({
        ...profile,
        aiConsent: {
          ...profile.aiConsent,
          extra: true,
        },
      }).success,
    ).toBe(false);
  });
});

describe('isAiConsentCurrent', () => {
  it.each([
    [
      'activo y vigente',
      {
        externalProviders: true,
        textVersion: '2026-09-20',
        currentTextVersion: '2026-09-20',
      },
      true,
    ],
    [
      'activo sobre versión anterior',
      {
        externalProviders: true,
        textVersion: '2026-09-20',
        currentTextVersion: '2026-11-02',
      },
      false,
    ],
    [
      'inactivo con fecha',
      {
        externalProviders: false,
        textVersion: '2026-09-20',
        currentTextVersion: '2026-09-20',
      },
      false,
    ],
    [
      'recién registrado',
      {
        externalProviders: false,
        textVersion: null,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
      false,
    ],
  ] as const)('%s → %s', (_label, consent, expected) => {
    expect(isAiConsentCurrent(consent)).toBe(expected);
  });
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

  it.each([
    [
      'activar con versión',
      {
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
        },
      },
      true,
    ],
    [
      'activar sin versión',
      { aiConsent: { externalProviders: true } },
      false,
    ],
    [
      'revocar sin versión',
      { aiConsent: { externalProviders: false } },
      true,
    ],
    [
      'revocar con versión',
      {
        aiConsent: {
          externalProviders: false,
          textVersion: AI_CONSENT_TEXT_VERSION,
        },
      },
      true,
    ],
    [
      'consentedAt enviado',
      {
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
          consentedAt: '2026-09-20T10:00:00.000Z',
        },
      },
      false,
    ],
    ['cuerpo vacío', {}, false],
  ] as const)('%s → válido: %s', (_label, body, valid) => {
    expect(updateProfileRequestSchema.safeParse(body).success).toBe(valid);
  });

  it('rejects currentTextVersion as unknown on the update body', () => {
    expect(
      updateProfileRequestSchema.safeParse({
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
      }).success,
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

describe('deleteAccountRequestSchema', () => {
  it('accepts a presented password', () => {
    expect(deleteAccountRequestSchema.parse({ password: 'x' })).toEqual({
      password: 'x',
    });
  });

  it('rejects an empty password', () => {
    expect(
      deleteAccountRequestSchema.safeParse({ password: '' }).success,
    ).toBe(false);
  });
});
