import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AI_CONSENT_TEXT,
  AI_CONSENT_TEXT_SHA256,
  AI_CONSENT_TEXT_VERSION,
  type AiConsentLanguage,
} from './ai-consent-text';
import { outputLanguageSchema } from '../schemas/user-profile.schema';

describe('AI_CONSENT_TEXT_VERSION', () => {
  it('tiene la forma fechada YYYY-MM-DD', () => {
    expect(AI_CONSENT_TEXT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('la versión anterior del placeholder ya no es la vigente', () => {
    // 16.7: el texto honesto sube de versión; un consentimiento sobre el placeholder no debe seguir valiendo.
    expect(AI_CONSENT_TEXT_VERSION).not.toBe('2026-09-20');
  });
});

describe('AI_CONSENT_TEXT_SHA256', () => {
  it('tiene un hash por cada idioma soportado', () => {
    const languages = outputLanguageSchema.options as AiConsentLanguage[];

    expect(Object.keys(AI_CONSENT_TEXT).sort()).toEqual([...languages].sort());
    expect(Object.keys(AI_CONSENT_TEXT_SHA256).sort()).toEqual(
      [...languages].sort(),
    );
  });

  it.each(Object.keys(AI_CONSENT_TEXT) as AiConsentLanguage[])(
    'el hash de %s coincide con el texto UTF-8',
    (language) => {
      const digest = createHash('sha256')
        .update(AI_CONSENT_TEXT[language], 'utf8')
        .digest('hex');

      expect(AI_CONSENT_TEXT_SHA256[language]).toBe(digest);
      expect(AI_CONSENT_TEXT_SHA256[language]).toMatch(/^[a-f0-9]{64}$/);
    },
  );
});
