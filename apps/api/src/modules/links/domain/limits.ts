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

/**
 * Pegados de descripción que puede hacer una persona en la ventana (D5 de paste-job-description). Cada uno es una
 * llamada a la IA dentro de una petición HTTP, así que se cuenta por persona, que es quien la gasta.
 */
export const PASTES_PER_USER = 10;

/**
 * `Retry-After` de un pegado que no se pudo leer ahora (503): la IA degradó o no respondió, o el contador no responde.
 * Es un fallo transitorio de un proveedor o de Redis, no una ventana que haya que esperar, así que se anuncia poco: un
 * minuto, lo que el SPA traduce como "inténtalo en un rato".
 */
export const PASTE_UNAVAILABLE_RETRY_AFTER_SECONDS = 60;

/**
 * `Retry-After` de la cuota diaria de IA agotada (429 `ai_quota_exceeded`): la ventana entera, 24 h. La política de
 * cuotas solo responde sí o no, así que es conservador y coincide con el mensaje, "vuelve mañana" (D5).
 */
export const AI_QUOTA_RETRY_AFTER_SECONDS = 24 * 60 * 60;

/**
 * Comentarios que una persona puede publicar en la ventana, en todos sus grupos (D6 de group-comments). Cuenta por
 * persona porque un script cambia de destino; borrar no cuenta.
 */
export const COMMENTS_PER_USER = 30;

// Rutas públicas (D8 de public-preview-share, ADR-027 §6). Son contadores **globales de ruta**: la clave es fija y no
// entra en ella la dirección de origen, ni ninguna cabecera, ni nada derivado de ellas. No hay nada que falsificar y no
// hacen falta ni `trustProxy` ni ninguna variable de configuración.
//
// Lo que acotan es el **coste** —que un bucle no nos haga leer Mongo sin fin—, no el abuso por cliente: 6000 cada 15
// min son unas 6,7 peticiones por segundo, al alcance de un bucle casero. El control por cliente exige un proxy
// configurado, que es de `deploy-prod` (ADR-020).

/** Páginas públicas que se sirven en la ventana, en total. */
export const PUBLIC_PAGE_VIEWS = 6000;

/** Previews públicos que sirve el endpoint del SPA en la ventana, en total. Independiente del de la página. */
export const PUBLIC_PREVIEW_VIEWS = 6000;

/**
 * Páginas de **un mismo enlace** en la ventana. Del orden de un tercio del global: bastante por encima de lo que recibe
 * un enlace pegado en un grupo de WhatsApp y bastante por debajo como para que un bucle contra un enlace no agote el
 * tope de los demás. Es un dato del recurso, no del cliente: lo lleva la ruta, no una cabecera.
 */
export const PUBLIC_PAGE_VIEWS_PER_SLUG = 2000;
