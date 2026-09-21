/**
 * Texto de consentimiento para proveedores de IA externos (D4, D5, ADR-030 §10).
 *
 * La **versión identifica el contenido y no el idioma**: reescribir el inglés también obliga a versionar, porque en
 * inglés se lee la misma promesa. Los hashes por idioma permiten detectar un desvío de una traducción sin confundirlo
 * con un cambio de versión.
 *
 * El texto abre por la consecuencia (el CV sale y puede identificar), dice qué pasa con el resto, que no podemos
 * comprobar al proveedor y cómo se revoca. Subir la redacción exige una versión nueva (tarea 16.7); el SPA debe
 * publicar el mismo texto que estos hashes (tarea 16.8).
 */

/** Versión vigente del texto (identificador fechado `YYYY-MM-DD`). */
export const AI_CONSENT_TEXT_VERSION = '2026-09-21';

/**
 * Texto canónico por idioma publicado. Debe coincidir con la unidad `profile.ai.consentText` del SPA (source ES /
 * target EN).
 */
export const AI_CONSENT_TEXT = {
  es: 'Con este permiso, el texto de tu CV sale de LinkVault hacia un proveedor de IA externo (hoy OpenRouter) y lo que se envía puede identificarte. Se envían el texto de tu CV y la descripción de la oferta. Antes de enviarlo sustituimos tu email, tus teléfonos, tu dirección, tu documento de identidad y las URL por marcadores, y también tu nombre, salvo que lo desactives más abajo. El resto de tu CV —tu experiencia, tus estudios, las empresas y las fechas— se envía tal cual y puede identificarte. Elegimos proveedores que se comprometen a no usar lo enviado para entrenar sus modelos, pero no podemos comprobarlo. Puedes quitar este permiso cuando quieras. Sin este permiso, tu CV se analiza dentro de LinkVault y, si aquí no hay IA disponible, recibes un análisis básico, sin sugerencias.',
  en: 'With this permission, the text of your CV leaves LinkVault for an external AI provider (today OpenRouter), and what is sent can identify you. We send the text of your CV and the job description. Before sending, we replace your email, phone numbers, address, identity document and URLs with placeholders, and also your name unless you turn that off below. The rest of your CV —your experience, education, employers and dates— is sent as-is and can identify you. We choose providers that commit not to use what is sent to train their models, but we cannot verify that. You can withdraw this permission anytime. Without this permission, your CV is analyzed inside LinkVault and, if no AI is available here, you get a basic analysis with no suggestions.',
} as const;

export type AiConsentLanguage = keyof typeof AI_CONSENT_TEXT;

/**
 * SHA-256 (hex) del texto UTF-8 de cada idioma. Precalculados para no depender de `node:crypto` en el bundle del SPA
 * (`platform:any`). Los tests de este módulo comprueban que coinciden con `AI_CONSENT_TEXT`.
 */
export const AI_CONSENT_TEXT_SHA256: Readonly<
  Record<AiConsentLanguage, string>
> = {
  es: 'f5b933a6f7f4b2455a305b8d86a01fbf237d0b9cb2df9d2dffe7986036cd6ba2',
  en: '978460cee71985f7f5132b24a60f26cd941fe8043f8d327f0d162b255b65a8bb',
};
