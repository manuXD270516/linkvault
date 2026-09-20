// Etiqueta legible de un link sin título. Vive en `libs/shared` (D10 de public-preview-share) porque la necesitan a la
// vez la tarjeta del SPA y la plantilla de la página pública de la API: dos copias darían dos títulos distintos para la
// misma oferta. Se movió tal cual desde `apps/web/.../links/link-preview.ts`, sin cambiar su comportamiento.

/** Extensión de fichero al final del último segmento (`.html`, `.aspx`…): ruido para la etiqueta. */
const FILE_EXTENSION = /\.[a-z0-9]{1,5}$/i;

/**
 * Etiqueta legible de un link: el último segmento del path des-slugificado (sin guiones ni extensión) o, si el path no
 * tiene segmentos, el dominio sin `www.`. Se deriva de `displayUrl`, la URL tal como la escribió una persona, porque la
 * normalizada pierde el slug con el puesto y la empresa. Una cadena que no es una URL se muestra tal cual.
 *
 * Solo se usa cuando el preview no trae título: en cuanto la oferta se pudo leer, se dice su título de verdad.
 */
export function linkLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const lastSegment = parsed.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .at(-1);
  if (lastSegment === undefined) {
    return host;
  }
  const label = deslugify(lastSegment);
  return label.length === 0 ? host : label;
}

function deslugify(segment: string): string {
  return decodeSegment(segment)
    .replace(FILE_EXTENSION, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Un porcentaje suelto no se puede decodificar: se muestra el segmento tal cual.
    return segment;
  }
}
