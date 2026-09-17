import type { Canonicalizer } from './canonicalizer';
import { isDomain, pathSegments } from './canonicalizer';

// Trabajopolis publica la oferta en `trabajopolis.bo/trabajo/<id>/<slug>`: el número es el identificador y el slug, que
// cambia con el título, se ignora. El `search_id` de la query viene de la búsqueda que llevó a la oferta y no forma
// parte de su identidad; no hace falta añadirlo a los parámetros de campaña de la normalización, porque la clave de una
// plataforma reconocida es `platform:externalJobId` y no la URL.

/** Identificador de oferta: solo dígitos. */
const OFFER_ID = /^\d+$/;

export const trabajopolisCanonicalizer: Canonicalizer = (url) => {
  if (!isDomain(url, 'trabajopolis.bo')) {
    return null;
  }
  const segments = pathSegments(url);
  if (segments[0] !== 'trabajo') {
    return null;
  }
  const externalJobId = segments[1] ?? '';
  return OFFER_ID.test(externalJobId)
    ? { platform: 'trabajopolis', externalJobId }
    : null;
};
