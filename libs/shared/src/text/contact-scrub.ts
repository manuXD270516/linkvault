// Higiene del texto de un aviso (D7 de link-enrichment, C17). Los avisos de empleo llevan el email y el teléfono del
// reclutador, que son datos de **un tercero**: ni hacen falta para leer la oferta, ni deben viajar a un proveedor de
// IA, ni tienen por qué quedarse guardados en el resumen. No es redacción reversible; es no llevarse lo que no sirve,
// y de paso ahorra tokens.
//
// Es una regla sobre texto, sin dependencias, y vive en `libs/shared` desde paste-job-description (D4) porque la
// necesitan los dos procesos: en el worker, el parser de HTML al construir el texto limpio y los extractores de
// JSON-LD y metadatos al recortar la descripción; en `api`, el texto pegado antes de llegar a la IA.
//
// Su comportamiento **no cambia** con la mudanza, aunque junte el texto en una sola línea: la entrada de `extract-job`
// sale de aquí, y cambiarla invalidaría los fixtures de páginas. Por eso los inputs del golden de texto pegado se guardan
// ya pasados por esta función.

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
