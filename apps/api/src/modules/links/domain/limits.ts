import { InvalidUrl, TextTooLong } from './errors';

// Límites de negocio de `links` (D8 de job-links). NO los valida el contrato HTTP, que solo pone cotas de cordura muy por
// encima: así una URL larguísima responde `invalid_url` y un chat entero pegado `text_too_long`, en vez del
// `validation_error` genérico del pipe, que el SPA no sabría explicar (mismo patrón que el código de invitación).

/** Máximo de caracteres de una URL guardada (spec links/job-link). */
export const MAX_URL_LENGTH = 2048;

/** Máximo de caracteres del texto de una importación (spec links/sharing). */
export const MAX_IMPORT_TEXT_LENGTH = 20_000;

/**
 * Máximo de links que una importación guarda por llamada (spec links/sharing). Cuenta solo los que hay que guardar, no
 * los que ya estaban en el destino: así volver a pegar el mismo chat avanza con los siguientes en vez de no hacer nada.
 */
export const MAX_LINKS_PER_IMPORT = 50;

/** Longitud en code points, el mismo criterio que zod 4. */
function lengthOf(value: string): number {
  return [...value].length;
}

/** `true` si la URL pasa del máximo. Se mide la URL tal y como la escribió la persona. */
export function isUrlTooLong(url: string): boolean {
  return lengthOf(url) > MAX_URL_LENGTH;
}

/** `true` si el texto importado pasa del máximo. */
export function isImportTextTooLong(text: string): boolean {
  return lengthOf(text) > MAX_IMPORT_TEXT_LENGTH;
}

/** Rechaza una URL demasiado larga antes de gastar una consulta en ella. */
export function assertUrlWithinLimit(url: string): void {
  if (isUrlTooLong(url)) {
    throw new InvalidUrl();
  }
}

/** Rechaza un texto demasiado largo antes de recorrerlo buscando URLs. */
export function assertImportTextWithinLimit(text: string): void {
  if (isImportTextTooLong(text)) {
    throw new TextTooLong();
  }
}

// Límites por ventana de tiempo (spec links/enrichment y links/sharing, D13 de link-enrichment). El contador vive detrás
// del puerto LINK_LIMITER; aquí solo están los números y cuánto dura su ventana.

/** Ventana de los dos límites por tiempo de `links`. La misma que la de `auth`, para no inventar una segunda unidad. */
export const LINK_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Relecturas que se pueden pedir de un mismo link en la ventana. Cuenta **por link y no por persona**: lo que el límite
 * protege es al sitio del que se descarga, no a nuestro servidor, así que dos miembros del mismo grupo pulsando
 * "reintentar" cuentan contra el mismo contador.
 */
export const ENRICH_RETRIES_PER_LINK = 3;

/** Importaciones que puede hacer una persona en la ventana. Cada una guarda hasta `MAX_LINKS_PER_IMPORT` links. */
export const IMPORTS_PER_USER = 10;
