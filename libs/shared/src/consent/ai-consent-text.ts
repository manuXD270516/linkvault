/**
 * Texto de consentimiento para proveedores de IA externos (D4, D5, ADR-030 §10).
 *
 * La **versión identifica el contenido y no el idioma**: reescribir el inglés también obliga a versionar, porque en
 * inglés se lee la misma promesa. Los hashes por idioma permiten detectar un desvío de una traducción sin confundirlo
 * con un cambio de versión.
 *
 * Los textos de abajo son **placeholders** de este change. La versión vigente se sube en la tarea 16.7 y el test que
 * compara los hashes con el texto real del SPA va en 16.8; hasta entonces, api y worker pueden referenciar
 * `AI_CONSENT_TEXT_VERSION` y las pantallas pueden alinear su copia contra `AI_CONSENT_TEXT` / `AI_CONSENT_TEXT_SHA256`.
 */

/** Versión vigente del texto (identificador fechado `YYYY-MM-DD`). */
export const AI_CONSENT_TEXT_VERSION = '2026-09-20';

/** Textos placeholder por idioma publicado. 16.7/16.8 los sustituyen por la copia del SPA. */
export const AI_CONSENT_TEXT = {
  es: 'Placeholder ES consent text for LinkVault AI external providers. Tasks 16.7/16.8 will sync with the SPA.',
  en: 'Placeholder EN consent text for LinkVault AI external providers. Tasks 16.7/16.8 will sync with the SPA.',
} as const;

export type AiConsentLanguage = keyof typeof AI_CONSENT_TEXT;

/**
 * SHA-256 (hex) del texto UTF-8 de cada idioma. Precalculados para no depender de `node:crypto` en el bundle del SPA
 * (`platform:any`). Los tests de este módulo comprueban que coinciden con `AI_CONSENT_TEXT`.
 */
export const AI_CONSENT_TEXT_SHA256: Readonly<
  Record<AiConsentLanguage, string>
> = {
  es: 'bec268cb14fb0d4ecb622ba3efc96a7e668bfc6bcaedd203fe3df3942432275a',
  en: 'e57ab60e92fc80dcb231513dcfc8de80eaf3b8165cedd19173d28404dccb9b50',
};
