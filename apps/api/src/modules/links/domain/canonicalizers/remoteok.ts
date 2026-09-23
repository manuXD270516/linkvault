import type { Canonicalizer } from './canonicalizer';
import { isDomain, pathSegments } from './canonicalizer';

// Remote OK publica ofertas en `remoteok.com/remote-jobs/<slug>`. El identificador estable es el id
// numérico de la API (ADR-043). La forma canónica que emite discovery es `/remote-jobs/<id>-…`
// (id al inicio). También se acepta el slug real de Remote OK con el id al final
// (`…-company-<id>`), para URLs pegadas a mano.

/** Id numérico al inicio del slug: forma canónica de discovery. */
const ID_AT_START = /^(\d+)(?:-|$)/;

/** Id numérico al final del slug: forma habitual de las URLs publicadas en Remote OK. */
const ID_AT_END = /-(\d+)$/;

export const remoteokCanonicalizer: Canonicalizer = (url) => {
  if (!isDomain(url, 'remoteok.com')) {
    return null;
  }
  const segments = pathSegments(url);
  if (segments[0] !== 'remote-jobs' || segments.length !== 2) {
    return null;
  }
  const slug = segments[1] ?? '';
  const fromStart = ID_AT_START.exec(slug);
  if (fromStart?.[1] !== undefined) {
    return { platform: 'remoteok', externalJobId: fromStart[1] };
  }
  const fromEnd = ID_AT_END.exec(slug);
  if (fromEnd?.[1] !== undefined) {
    return { platform: 'remoteok', externalJobId: fromEnd[1] };
  }
  return null;
};
