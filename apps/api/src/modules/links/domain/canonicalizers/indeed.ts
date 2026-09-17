import type { Canonicalizer } from './canonicalizer';
import { isDomain } from './canonicalizer';

// Indeed identifica la vacante con `jk` en cualquiera de sus rutas (`/viewjob`, `/m/viewjob`, `/rc/clk`, `/pagead/clk`),
// y con `vjk` cuando la oferta se abre en el panel lateral de la búsqueda. Tiene un dominio por país (`bo.indeed.com`,
// `indeed.com.mx`), así que el host se reconoce con sus dos formas.

/** Identificador de vacante de Indeed: hexadecimal de 16 caracteres, acotado por si cambia de longitud. */
const JOB_KEY = /^[0-9a-z]{8,32}$/i;

/** Dominio por país con TLD propio: `indeed.com.mx`, `indeed.com.pe`… */
const COUNTRY_DOMAIN = /(?:^|\.)indeed\.com\.[a-z]{2}$/;

export const indeedCanonicalizer: Canonicalizer = (url) => {
  if (!isDomain(url, 'indeed.com') && !COUNTRY_DOMAIN.test(url.hostname)) {
    return null;
  }
  const jobKey = url.searchParams.get('jk') ?? url.searchParams.get('vjk');
  if (jobKey === null || !JOB_KEY.test(jobKey)) {
    return null;
  }
  return { platform: 'indeed', externalJobId: jobKey };
};
