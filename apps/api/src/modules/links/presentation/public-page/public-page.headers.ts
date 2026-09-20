// Cabeceras de las tres respuestas de la página pública (D4 y D7 de public-preview-share, ADR-027 §4 y §5).

/**
 * Cabeceras de seguridad, iguales en `200`, `404` y `429`:
 *
 * - `Referrer-Policy: no-referrer`. Sin ella, al pulsar "Ver la oferta original" el navegador mandaría a la bolsa un
 *   `Referer` con el slug dentro, y ese slug es la llave de una página que cualquiera puede abrir: acabaría en los logs
 *   de un tercero.
 * - `X-Content-Type-Options: nosniff`, para que ningún navegador reinterprete el cuerpo como otra cosa.
 * - una CSP en la que **`script-src` no aparece**, así que lo cubre `default-src 'none'`: la página no ejecuta ni una
 *   línea de JavaScript. Tampoco aparece `img-src`, porque la página **no pinta ninguna imagen**: `og:image` es una
 *   etiqueta del `<head>` que descarga el crawler del chat desde su propio servidor. El único hueco es el `style-src`
 *   del CSS mínimo en línea. Es defensa en profundidad sobre el escapado.
 */
export const PUBLIC_PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/** `text/html; charset=utf-8` en las tres respuestas: esta ruta NUNCA devuelve `application/json`. */
export const PUBLIC_PAGE_CONTENT_TYPE = 'text/html; charset=utf-8';

/**
 * Caché de un `200`: un minuto, suficiente para absorber a los diez bots que piden la misma URL cuando el enlace se
 * pega en un grupo y poco bastante para que despublicar se note casi enseguida. **Sin `Vary`**, porque no se mira
 * ninguna cabecera de la petición, y sin `ETag`: el cuerpo cambia cuando el preview se enriquece y no hay nada que
 * revalidar que cueste menos que las dos lecturas.
 */
export const PUBLIC_PAGE_CACHE_CONTROL = 'public, max-age=60';

/**
 * Un `404` no tiene por qué ser permanente desde fuera —un despliegue a medias, una base que no responde—, y cachearlo
 * dejaría muerta una URL que sí existe. El `429` tampoco se cachea.
 */
export const PUBLIC_PAGE_NO_STORE = 'no-store';
