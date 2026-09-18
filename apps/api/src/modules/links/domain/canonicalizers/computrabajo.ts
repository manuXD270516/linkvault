import type { Canonicalizer } from './canonicalizer';
import { isDomain, pathSegments } from './canonicalizer';

// Computrabajo publica la oferta bajo `.../ofertas-de-trabajo/oferta-de-trabajo-<slug>-<id>` (con o sin `.html`), donde
// el slug lleva el puesto, la ciudad y a veces la empresa y cambia entre enlaces de la misma oferta (D2 de job-links).
// Lo estable es el identificador final. Tiene un dominio por país (`bo.computrabajo.com`, `computrabajo.com.mx`).

/** Segmento que abre la oferta; lo que sigue hasta el identificador es slug variable. */
const OFFER_SEGMENT_PREFIX = 'oferta-de-trabajo';

/** Identificador de oferta: hexadecimal (los reales tienen 16), acotado por si cambia de longitud. */
const OFFER_ID = /^[0-9a-f]{8,}$/i;

/** Dominio por país con TLD propio: `computrabajo.com.mx`, `computrabajo.com.ve`… */
const COUNTRY_DOMAIN = /(?:^|\.)computrabajo\.com\.[a-z]{2}$/;

export const computrabajoCanonicalizer: Canonicalizer = (url) => {
  if (
    !isDomain(url, 'computrabajo.com') &&
    !COUNTRY_DOMAIN.test(url.hostname)
  ) {
    return null;
  }
  const externalJobId = offerIdOf(pathSegments(url));
  return externalJobId === null
    ? null
    : { platform: 'computrabajo', externalJobId };
};

/**
 * Identificador del último segmento que empieza por `oferta-de-trabajo`, sin su extensión y en minúsculas: es
 * hexadecimal, así que dos enlaces de la misma oferta con distinta caja son la misma vacante.
 */
function offerIdOf(segments: readonly string[]): string | null {
  const offer = segments.find((segment) =>
    segment.startsWith(OFFER_SEGMENT_PREFIX),
  );
  if (offer === undefined) {
    return null;
  }
  const parts = offer.replace(/\.html?$/i, '').split('-');
  const last = parts[parts.length - 1];
  return last !== undefined && OFFER_ID.test(last) ? last.toLowerCase() : null;
}
