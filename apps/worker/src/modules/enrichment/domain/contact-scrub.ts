// Higiene del texto de un aviso (D7 de link-enrichment, C17). Los avisos de empleo llevan el email y el teléfono del
// reclutador, que son datos de **un tercero**: ni hacen falta para leer la oferta, ni deben viajar a un proveedor de
// IA, ni tienen por qué quedarse guardados en el resumen. No es redacción reversible; es no llevarse lo que no sirve,
// y de paso ahorra tokens.
//
// Vive en `domain/` porque es una regla sobre texto, sin dependencias: la usan el parser de HTML
// (`infrastructure/html/`) al construir el texto limpio y el extractor de JSON-LD al recortar la descripción, que es
// el otro sitio por donde un correo entraría en el preview.

/** `mailto:` y `tel:` escritos tal cual en el texto. */
const CONTACT_URI = /\b(?:mailto|tel|callto|whatsapp):\S+/gi;

/** Direcciones de correo. */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Teléfonos: entre 7 y 15 dígitos, con prefijo internacional y prefijo de zona opcionales, separados como mucho por
 * un espacio o un guion.
 *
 * El punto **no** es separador a propósito: en español es el separador de millares, y aceptarlo convertiría un salario
 * de "20.000.000" en un teléfono. Por el mismo motivo el separador es de un solo carácter: "15 000 - 20 000" es un
 * rango salarial, no un número. Lo que se pierde a cambio es algún teléfono escrito de forma rara, que es un precio
 * mucho más barato que borrar el salario de la oferta.
 */
const PHONE =
  /(?<!\d)(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d(?:[\s-]?\d){6,14}(?!\d)/g;

/**
 * El mismo texto sin datos de contacto. Lo quitado no se sustituye por una marca: no hay nada que recuperar después y
 * un `[EMAIL]` solo sería ruido para el modelo.
 */
export function scrubContactDetails(text: string): string {
  return text
    .replace(CONTACT_URI, ' ')
    .replace(EMAIL, ' ')
    .replace(PHONE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
