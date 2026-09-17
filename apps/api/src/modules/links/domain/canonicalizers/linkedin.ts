import type { Canonicalization, Canonicalizer } from './canonicalizer';
import { isDomain, pathSegments } from './canonicalizer';

// LinkedIn publica la misma vacante con tres formas de URL (C1 de design v0.2): `/jobs/view/<id>`, el `/comm/jobs/view/<id>`
// de sus correos y el `currentJobId=<id>` de la búsqueda. Las tres llevan el mismo identificador numérico.

/** Identificador de vacante de LinkedIn: solo dígitos (los reales tienen 9 o 10). */
const JOB_ID = /^\d{6,}$/;

/** El último segmento de `/jobs/view/` puede venir con slug (`backend-developer-at-acme-3811111111`). */
const JOB_ID_AT_END = /(?:^|-)(\d{6,})$/;

export const linkedinCanonicalizer: Canonicalizer = (url) => {
  if (!isDomain(url, 'linkedin.com')) {
    return null;
  }
  const fromPath = jobIdFromPath(url);
  if (fromPath !== null) {
    return canonicalization(fromPath);
  }
  const currentJobId = url.searchParams.get('currentJobId');
  if (currentJobId !== null && JOB_ID.test(currentJobId)) {
    return canonicalization(currentJobId);
  }
  return null;
};

/** `/jobs/view/<id>` y el `/comm/jobs/view/<id>` de los correos, con o sin slug en el último segmento. */
function jobIdFromPath(url: URL): string | null {
  const segments = pathSegments(url);
  const start = segments[0] === 'comm' ? 1 : 0;
  if (segments[start] !== 'jobs' || segments[start + 1] !== 'view') {
    return null;
  }
  const last = segments[start + 2];
  return last === undefined ? null : (JOB_ID_AT_END.exec(last)?.[1] ?? null);
}

function canonicalization(externalJobId: string): Canonicalization {
  return { platform: 'linkedin', externalJobId };
}
