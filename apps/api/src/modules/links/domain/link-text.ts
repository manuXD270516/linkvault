import { isUrlTooLong } from './limits';
import { normalizeUrl } from './url';

// Extracción de URLs de un texto pegado (D5 de job-links): normalmente la exportación de un chat, con marcas de hora,
// nombres y teléfonos. Solo salen de aquí las URLs; el texto no se guarda ni se registra en ningún sitio (spec
// links/sharing), así que este módulo lo recibe, lo recorre y lo olvida.

/**
 * Candidato a URL: un esquema seguido de `://` y todo lo que no sea un espacio. Deliberadamente amplio en el esquema
 * para que un `ftp://…` o un `http://` suelto salgan como candidatos y se cuenten en `unrecognized`, en vez de pasar
 * desapercibidos: quien pega el chat espera que le digan qué enlaces no se pudieron leer.
 */
const URL_CANDIDATE = /[a-z][a-z0-9+.-]*:\/\/\S*/gi;

/** Puntuación y adornos con los que el chat cierra un enlace: `(mira esto: https://…),` o `«https://…»`. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}»"'…]+$/u;

/** URLs encontradas en el texto y cuántos candidatos no se pudieron leer. */
export interface ExtractedUrls {
  /** En el orden en que aparecen, tal y como se escribieron, sin repetir tras normalizar. */
  readonly urls: readonly string[];
  /** Candidatos que no superan la normalización (esquema no soportado, sin host, demasiado largos). */
  readonly unrecognized: number;
}

/**
 * URLs de un texto plano. Una URL que no supera la normalización no rompe la importación: se cuenta en `unrecognized` y
 * se sigue con el resto. Dos URLs que normalizan igual son la misma entrada y se conserva la primera que apareció.
 */
export function extractUrls(text: string): ExtractedUrls {
  const urls: string[] = [];
  const seen = new Set<string>();
  let unrecognized = 0;

  for (const match of text.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '');
    const normalized = isUrlTooLong(candidate) ? null : normalizeUrl(candidate);
    if (normalized === null) {
      unrecognized += 1;
      continue;
    }
    if (seen.has(normalized.normalizedUrl)) {
      continue;
    }
    seen.add(normalized.normalizedUrl);
    urls.push(candidate);
  }

  return { urls, unrecognized };
}
