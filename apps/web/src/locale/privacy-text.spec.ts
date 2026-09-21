import {
  AI_CONSENT_TEXT,
  AI_CONSENT_TEXT_SHA256,
  AI_CONSENT_TEXT_VERSION,
  REDACTED_DATA_TYPES,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import enMessages from './messages.en.xlf' with { loader: 'text' };
import sourceMessages from './messages.xlf' with { loader: 'text' };
import {
  ENUMERATION_SCREENS,
  PRIVACY_UNIT_IDS,
  assertConsentHashMatches,
  checkConsentContent,
  checkEnumeration,
  checkForbiddenPromises,
  checkRevocationContent,
  parseXlfUnits,
  unitText,
} from './privacy-text';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const sourceUnits = parseXlfUnits(sourceMessages);
const enUnits = parseXlfUnits(enMessages);

describe('consent text hashing (16.8)', () => {
  it('El consentimiento se traduce entero', () => {
    const es = sourceUnits.get(PRIVACY_UNIT_IDS.consentText);
    const en = enUnits.get(PRIVACY_UNIT_IDS.consentText);
    expect(es, 'consent must be a single Spanish unit').toBeDefined();
    expect(en?.target, 'consent must have a full English target').toBeTruthy();
    for (const id of sourceUnits.keys()) {
      expect(id.startsWith('profile.ai.consentText.')).toBe(false);
    }
  });

  it.each(['es', 'en'] as const)(
    'hash of %s SPA text matches AI_CONSENT_TEXT_SHA256 (fails naming the version)',
    async (language) => {
      const units = language === 'es' ? sourceUnits : enUnits;
      const spaText = unitText(units, PRIVACY_UNIT_IDS.consentText, language);
      const hashHex = await sha256(spaText);
      expect(() =>
        assertConsentHashMatches(spaText, language, () => hashHex),
      ).not.toThrow();
      expect(AI_CONSENT_TEXT_SHA256[language]).toBe(await sha256(AI_CONSENT_TEXT[language]));
    },
  );

  it('Texto modificado sin versión nueva', async () => {
    const tampered = `${AI_CONSENT_TEXT.es} extra`;
    const hashHex = await sha256(tampered);
    expect(() => assertConsentHashMatches(tampered, 'es', () => hashHex)).toThrow(
      new RegExp(AI_CONSENT_TEXT_VERSION),
    );
  });

  it('Reescribir el texto en inglés obliga a versionar', async () => {
    const tampered = `${AI_CONSENT_TEXT.en} rewritten`;
    const hashHex = await sha256(tampered);
    expect(() => assertConsentHashMatches(tampered, 'en', () => hashHex)).toThrow(
      new RegExp(AI_CONSENT_TEXT_VERSION),
    );
  });
});

describe('consent and revocation content (16.9)', () => {
  it('Texto completo', () => {
    for (const language of ['es', 'en'] as const) {
      const units = language === 'es' ? sourceUnits : enUnits;
      expect(checkConsentContent(unitText(units, PRIVACY_UNIT_IDS.consentText, language), language)).toEqual(
        [],
      );
      expect(
        checkRevocationContent(unitText(units, PRIVACY_UNIT_IDS.consentRevoked, language), language),
      ).toEqual([]);
    }
  });

  it('Texto que solo enumera lo que se sustituye', () => {
    const incomplete =
      'Sustituimos tu email, tus teléfonos, tu dirección, tu documento de identidad y las URL por marcadores.';
    const failures = checkConsentContent(incomplete, 'es');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => /rest of CV|resto/i.test(f))).toBe(true);
  });

  it('Texto que promete anonimato', () => {
    const anon = `${AI_CONSENT_TEXT.es} El envío va anónimo.`;
    expect(checkConsentContent(anon, 'es').some((f) => /anonymity/i.test(f))).toBe(true);
  });

  it('Texto de revocación que calla el borrado', () => {
    const silent = 'Permiso retirado. Tus próximos análisis no saldrán de LinkVault.';
    const failures = checkRevocationContent(silent, 'es');
    expect(failures.some((f) => /prior analyses|path that deletes|unrecovered/i.test(f))).toBe(
      true,
    );
  });

  it('La comprobación exige la frase de revocar', () => {
    const withoutEnd =
      'Permiso retirado. Tus próximos análisis no saldrán de LinkVault. No borra los análisis que ya hiciste; para eso, elimina el CV con el que se hicieron.';
    expect(
      checkRevocationContent(withoutEnd, 'es').some((f) => /unrecovered/i.test(f)),
    ).toBe(true);
  });

  it('La comprobación exige el orden del consentimiento', () => {
    const reordered =
      'Se envían el texto de tu CV y la descripción de la oferta. Con este permiso, el texto de tu CV sale de LinkVault hacia un proveedor de IA externo (hoy OpenRouter) y lo que se envía puede identificarte. El resto de tu CV —tu experiencia, tus estudios, las empresas y las fechas— se envía tal cual y puede identificarte. Elegimos proveedores que se comprometen a no usar lo enviado para entrenar sus modelos, pero no podemos comprobarlo. Puedes quitar este permiso cuando quieras.';
    expect(checkConsentContent(reordered, 'es').some((f) => /first sentence/i.test(f))).toBe(true);
  });
});

describe('three-screen enumerations (16.10)', () => {
  it('Las tres pantallas enumeran lo mismo', () => {
    const failures: string[] = [];
    for (const language of ['es', 'en'] as const) {
      const units = language === 'es' ? sourceUnits : enUnits;
      for (const screen of ENUMERATION_SCREENS) {
        failures.push(
          ...checkEnumeration(unitText(units, screen.id, language), language, screen.screen),
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it('Una pantalla enumera de menos', () => {
    const withoutUrl =
      'sustituimos tu email, tus teléfonos, tu dirección, tu documento de identidad por marcadores, y también tu nombre, salvo que lo desactives allí';
    expect(checkEnumeration(withoutUrl, 'es', 'mi-cv').some((f) => /"url"/i.test(f))).toBe(true);
  });

  it('Una enumeración calla el nombre propio', () => {
    const withoutName =
      'sustituimos tu email, tus teléfonos, tu dirección, tu documento de identidad y las URL por marcadores';
    expect(checkEnumeration(withoutName, 'es', 'perfil').some((f) => /"name"/i.test(f))).toBe(
      true,
    );
  });

  it('Un detector nuevo que las pantallas no nombran', () => {
    // La lista canónica es REDACTED_DATA_TYPES: si creciera, las pantallas actuales fallarían.
    expect(REDACTED_DATA_TYPES.map((entry) => entry.type)).toContain('name');
    const failures: string[] = [];
    for (const screen of ENUMERATION_SCREENS) {
      failures.push(...checkEnumeration(unitText(sourceUnits, screen.id, 'es'), 'es', screen.screen));
    }
    expect(failures).toEqual([]);
  });

  it('Una traducción que enumera distinto', () => {
    const enWithoutPhone =
      'we replace your email, address, identity document and URLs with placeholders, and also your name unless you turn that off below';
    expect(checkEnumeration(enWithoutPhone, 'en', 'perfil').some((f) => /"phone"/i.test(f))).toBe(
      true,
    );
  });
});

describe('forbidden promises (16.13)', () => {
  const privacyIds = [
    PRIVACY_UNIT_IDS.consentText,
    PRIVACY_UNIT_IDS.consentRevoked,
    PRIVACY_UNIT_IDS.cvPrivacy,
    PRIVACY_UNIT_IDS.matchConsentSummary,
  ];

  it('La línea no promete lo que no hacemos', () => {
    const failures: string[] = [];
    for (const language of ['es', 'en'] as const) {
      const units = language === 'es' ? sourceUnits : enUnits;
      for (const id of privacyIds) {
        failures.push(...checkForbiddenPromises(unitText(units, id, language), language, id));
      }
    }
    expect(failures).toEqual([]);
  });

  it('La promesa vieja no sobrevive en inglés', () => {
    const oldEn = 'Your CV is only visible to you and today no AI reads it.';
    expect(checkForbiddenPromises(oldEn, 'en', 'cv.privacy').length).toBeGreaterThan(0);
    expect(checkForbiddenPromises(oldEn, 'en', 'cv.privacy')[0]).toContain('cv.privacy');
  });

  it('Una afirmación equivocada también rompe la comprobación', () => {
    const wrongEs =
      'sustituimos tu nombre solo si lo activas en Perfil, tu email, tus teléfonos, tu dirección, tu documento de identidad y las URL';
    expect(
      checkForbiddenPromises(wrongEs, 'es', PRIVACY_UNIT_IDS.cvPrivacy).some((f) =>
        /wrong name-default/i.test(f),
      ),
    ).toBe(true);
    const wrongEnOnly =
      'we replace your name only if you enable it in Profile, your email, phone numbers, address, identity document and URLs';
    expect(
      checkForbiddenPromises(wrongEnOnly, 'en', PRIVACY_UNIT_IDS.cvPrivacy).some((f) =>
        /wrong name-default/i.test(f),
      ),
    ).toBe(true);
  });

  it('Cambiar el texto obliga a un identificador nuevo', () => {
    expect(sourceUnits.has('cv.privacy.v2')).toBe(true);
    // La unidad vieja puede existir en el XLIFF residual, pero la pantalla no debe usarla: el id nuevo es obligatorio.
    expect(PRIVACY_UNIT_IDS.cvPrivacy).toBe('cv.privacy.v2');
    expect(PRIVACY_UNIT_IDS.cvPrivacy).not.toBe('cv.privacy');
  });
});
