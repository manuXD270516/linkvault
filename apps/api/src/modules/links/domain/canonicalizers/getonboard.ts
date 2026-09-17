import type { Canonicalizer } from './canonicalizer';
import { isDomain, pathSegments } from './canonicalizer';

// Get on Board publica la oferta en `getonbrd.com/jobs/<categoría>/<slug>` y su identificador estable es el slug, que
// lleva el puesto, la empresa, la modalidad y un sufijo corto propio de la oferta
// (`full-stack-developer-senior-witi-remote-afcb`). La categoría puede cambiar de enlace a enlace, así que no entra en
// la identidad. Solo se reconocen `/jobs/<slug>` y `/jobs/<categoría>/<slug>`: cualquier otra forma (subpáginas como
// `/apply`, prefijos de idioma) queda como `generic`, porque no se puede justificar con los enlaces conocidos.

/**
 * Slug de oferta: al menos tres partes separadas por guiones. El mínimo distingue la oferta (`backend-developer-acme`)
 * de un listado por categoría (`/jobs/programming`, `/jobs/data-science`), que comparte forma de path con
 * `/jobs/<slug>`; un listado mal reconocido fundiría todas las ofertas de esa categoría en un solo link.
 */
const OFFER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i;

export const getonboardCanonicalizer: Canonicalizer = (url) => {
  if (!isDomain(url, 'getonbrd.com')) {
    return null;
  }
  const segments = pathSegments(url);
  if (segments[0] !== 'jobs' || segments.length < 2 || segments.length > 3) {
    return null;
  }
  const slug = segments[segments.length - 1] ?? '';
  return OFFER_SLUG.test(slug)
    ? { platform: 'getonboard', externalJobId: slug.toLowerCase() }
    : null;
};
