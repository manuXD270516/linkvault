/**
 * Utilidades para comprobar textos de privacidad y consentimiento en los XLIFF (tareas 16.8–16.13).
 * Solo las usan los specs de `locale/`; no van al bundle de producción.
 */

import {
  AI_CONSENT_TEXT,
  AI_CONSENT_TEXT_SHA256,
  AI_CONSENT_TEXT_VERSION,
  REDACTED_DATA_TYPES,
  type AiConsentLanguage,
  type RedactedDataTypeId,
} from '@linkvault/shared';

/** Unidades de traducción relevantes para las tres enumeraciones y las promesas. */
export const PRIVACY_UNIT_IDS = {
  consentText: 'profile.ai.consentText',
  consentRevoked: 'profile.ai.consentRevoked',
  /** Identificador nuevo (ADR-030 §12): la línea vieja `cv.privacy` no puede heredarse. */
  cvPrivacy: 'cv.privacy.v2',
  matchConsentSummary: 'match.dialog.consentSummary',
} as const;

export interface XlfUnit {
  id: string;
  source: string;
  target: string | null;
}

/** Parsea un XLIFF 1.2 a unidades con texto plano (sin etiquetas internas, espacios colapsados). */
export function parseXlfUnits(xliff: string): Map<string, XlfUnit> {
  const document = new DOMParser().parseFromString(xliff, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XLIFF');
  }
  const units = new Map<string, XlfUnit>();
  for (const unit of Array.from(document.getElementsByTagName('trans-unit'))) {
    const id = unit.getAttribute('id') ?? '';
    const sourceEl = unit.getElementsByTagName('source')[0];
    const targetEl = unit.getElementsByTagName('target')[0] ?? null;
    units.set(id, {
      id,
      source: plainText(sourceEl),
      target: targetEl === null ? null : plainText(targetEl),
    });
  }
  return units;
}

/** Texto visible: hijos de texto + contenido de nodos, colapsando whitespace. */
function plainText(element: Element | undefined): string {
  if (element === undefined) {
    return '';
  }
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function unitText(
  units: Map<string, XlfUnit>,
  id: string,
  language: AiConsentLanguage,
): string {
  const unit = units.get(id);
  if (unit === undefined) {
    throw new Error(`Missing trans-unit "${id}"`);
  }
  if (language === 'es') {
    return unit.source;
  }
  if (unit.target === null || unit.target === '') {
    throw new Error(`trans-unit "${id}" without English target`);
  }
  return unit.target;
}

/** Palabras/frases por tipo e idioma para localizar cada dato en una enumeración. */
const TYPE_MARKERS: Record<
  RedactedDataTypeId,
  { es: RegExp; en: RegExp }
> = {
  email: { es: /\bemail\b/i, en: /\bemail\b/i },
  phone: { es: /tel[eé]fonos?/i, en: /phone numbers?/i },
  url: { es: /\bURL\b/, en: /\bURLs?\b/i },
  address: { es: /direcci[oó]n/i, en: /\baddress\b/i },
  id: { es: /documento de identidad/i, en: /identity document/i },
  name: { es: /\bnombre\b/i, en: /\bname\b/i },
};

/** Cómo se nombra el estado de fábrica del interruptor del nombre. */
const NAME_FACTORY_MARKERS = {
  es: /salvo que lo desactiv/i,
  en: /unless you turn (that|it) off/i,
};

/** Formulaciones de anonimato prohibidas. */
const ANONYMITY_MARKERS = {
  es: /\ban[oó]nim[oa]|despersonaliz|no se puede saber de qui[eé]n|no identificable|va an[oó]nim/i,
  en: /\banonymous|anonymiz|de[- ]?identif|cannot tell whose|not identifiable\b/i,
};

/** Promesas viejas que este change ya no cumple. */
const FORBIDDEN_PROMISES = {
  es: [
    /hoy no lo lee ninguna IA/i,
    /no lo lee ninguna IA/i,
    /ninguna IA lee/i,
    /no saldrá de LinkVault sin tu autorizaci[oó]n(?!\s*\.)/i,
    /no sale nunca de LinkVault/i,
  ],
  en: [
    /no AI reads/i,
    /today no AI/i,
    /never leaves LinkVault/i,
    /does not leave LinkVault(?! without)/i,
  ],
};

/** Afirmación equivocada: nombre solo si se activa (cuando nace activado). */
const WRONG_NAME_DEFAULT = {
  es: /solo si (?:lo )?activ|si lo activas/i,
  en: /only if you (enable|turn (it|that) on)/i,
};

export interface EnumerationScreen {
  id: string;
  screen: 'perfil' | 'mi-cv' | 'match-dialog';
}

export const ENUMERATION_SCREENS: readonly EnumerationScreen[] = [
  { id: PRIVACY_UNIT_IDS.consentText, screen: 'perfil' },
  { id: PRIVACY_UNIT_IDS.cvPrivacy, screen: 'mi-cv' },
  { id: PRIVACY_UNIT_IDS.matchConsentSummary, screen: 'match-dialog' },
];

/**
 * Comprueba que el texto nombra exactamente los tipos canónicos y, para `name`, el estado de fábrica del interruptor.
 * Devuelve mensajes de fallo (vacío = ok).
 */
export function checkEnumeration(
  text: string,
  language: AiConsentLanguage,
  screen: string,
): string[] {
  const failures: string[] = [];
  for (const entry of REDACTED_DATA_TYPES) {
    const marker = TYPE_MARKERS[entry.type][language];
    if (!marker.test(text)) {
      failures.push(
        `${screen}/${language}: missing type "${entry.type}" (canonical list from REDACTED_DATA_TYPES)`,
      );
    }
  }
  // Tipos inventados no se buscan: la lista canónica es la fuente; sobra se detecta si alguien nombra cosas
  // fuera de los marcadores conocidos (p. ej. "IBAN") — opcional. Lo crítico es no omitir.
  if (NAME_FACTORY_MARKERS[language].test(text) === false && TYPE_MARKERS.name[language].test(text)) {
    failures.push(
      `${screen}/${language}: names "name" without saying the switch factory default (on)`,
    );
  }
  return failures;
}

/** Contenido obligatorio del texto de consentimiento (cuatro puntos + primera frase + sin anonimato). */
export function checkConsentContent(
  text: string,
  language: AiConsentLanguage,
): string[] {
  const failures: string[] = [];
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;

  if (language === 'es') {
    if (
      !/sale de LinkVault hacia un proveedor de IA externo/i.test(firstSentence) ||
      !/puede identificar/i.test(firstSentence)
    ) {
      failures.push(
        `consent/${language}: first sentence must say the CV leaves for an external provider and can identify (version ${AI_CONSENT_TEXT_VERSION})`,
      );
    }
    if (!/resto de tu CV[\s\S]*se envía tal cual/i.test(text)) {
      failures.push(`consent/${language}: missing "rest of CV is sent as-is"`);
    }
    if (!/puede identificarte/i.test(text)) {
      failures.push(`consent/${language}: missing that the rest can identify`);
    }
    if (!/no podemos comprobarlo/i.test(text)) {
      failures.push(`consent/${language}: missing that the provider cannot be verified`);
    }
    if (!/Puedes quitar este permiso cuando quieras/i.test(text)) {
      failures.push(`consent/${language}: missing how to revoke`);
    }
  } else {
    if (
      !/leaves LinkVault for an external AI provider/i.test(firstSentence) ||
      !/can identify you/i.test(firstSentence)
    ) {
      failures.push(
        `consent/${language}: first sentence must say the CV leaves for an external provider and can identify (version ${AI_CONSENT_TEXT_VERSION})`,
      );
    }
    if (!/rest of your CV[\s\S]*sent as-is/i.test(text)) {
      failures.push(`consent/${language}: missing "rest of CV is sent as-is"`);
    }
    if (!/can identify you/i.test(text)) {
      failures.push(`consent/${language}: missing that the rest can identify`);
    }
    if (!/cannot verify/i.test(text)) {
      failures.push(`consent/${language}: missing that the provider cannot be verified`);
    }
    if (!/withdraw this permission anytime/i.test(text)) {
      failures.push(`consent/${language}: missing how to revoke`);
    }
  }

  if (ANONYMITY_MARKERS[language].test(text)) {
    failures.push(`consent/${language}: anonymity wording found`);
  }
  return failures;
}

/** Mensaje de revocación: no borra análisis, nombra la vía, termina con lo ya enviado. */
export function checkRevocationContent(
  text: string,
  language: AiConsentLanguage,
): string[] {
  const failures: string[] = [];
  const trimmed = text.trim();
  if (language === 'es') {
    if (!/No borra los análisis que ya hiciste/i.test(text)) {
      failures.push(`revoke/${language}: missing that prior analyses are kept`);
    }
    if (!/elimina el CV/i.test(text)) {
      failures.push(`revoke/${language}: missing the path that deletes analyses`);
    }
    if (!/Lo que ya se envió a un proveedor externo no se puede recuperar\.?\s*$/i.test(trimmed)) {
      failures.push(`revoke/${language}: must end with unrecovered external send`);
    }
  } else {
    if (!/does not delete the analyses you already made/i.test(text)) {
      failures.push(`revoke/${language}: missing that prior analyses are kept`);
    }
    if (!/delete the CV you used/i.test(text)) {
      failures.push(`revoke/${language}: missing the path that deletes analyses`);
    }
    if (!/What was already sent to an external provider cannot be recovered\.?\s*$/i.test(trimmed)) {
      failures.push(`revoke/${language}: must end with unrecovered external send`);
    }
  }
  return failures;
}

/** Promesas desmentidas o afirmaciones equivocadas en cualquier unidad de privacidad. */
export function checkForbiddenPromises(
  text: string,
  language: AiConsentLanguage,
  unitId: string,
): string[] {
  const failures: string[] = [];
  for (const pattern of FORBIDDEN_PROMISES[language]) {
    if (pattern.test(text)) {
      failures.push(`${unitId}/${language}: forbidden promise matched ${pattern}`);
    }
  }
  if (WRONG_NAME_DEFAULT[language].test(text)) {
    failures.push(
      `${unitId}/${language}: wrong name-default wording (redactName starts ON)`,
    );
  }
  if (ANONYMITY_MARKERS[language].test(text)) {
    failures.push(`${unitId}/${language}: anonymity wording found`);
  }
  return failures;
}

/** Recalcula el hash del texto del SPA y falla nombrando la versión si no coincide. */
export function assertConsentHashMatches(
  spaText: string,
  language: AiConsentLanguage,
  hashHex: (value: string) => string,
): void {
  const digest = hashHex(spaText);
  const expected = AI_CONSENT_TEXT_SHA256[language];
  if (digest !== expected) {
    throw new Error(
      `Consent text hash mismatch for ${language} at version ${AI_CONSENT_TEXT_VERSION}: spa=${digest} expected=${expected}`,
    );
  }
  if (spaText !== AI_CONSENT_TEXT[language]) {
    throw new Error(
      `Consent text body mismatch for ${language} at version ${AI_CONSENT_TEXT_VERSION}`,
    );
  }
}
