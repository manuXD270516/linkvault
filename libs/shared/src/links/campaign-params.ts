// Parámetros de campaña y de seguimiento de una URL (spec links/job-link). Viven en `libs/shared` (D6 de
// public-preview-share) porque los usan dos funciones que **no pueden separarse**: `normalizeUrl`, que los descarta para
// calcular la identidad de una vacante, y `publicHttpUrl`, que los quita de la URL que se publica. Dos listas acabarían
// divergiendo justo cuando importa: un `mc_eid` puede llevar dentro el email de quien recibió el correo de la bolsa.

/** Prefijo de los parámetros de campaña de Google Analytics (`utm_source`, `utm_medium`…). */
export const CAMPAIGN_PARAM_PREFIX = 'utm_';

/**
 * Lista cerrada y en minúsculas. Cerrada a propósito: quitar cualquier parámetro desconocido fundiría vacantes distintas
 * que solo se diferencian por un parámetro de verdad (`jk`, `currentJobId`…) y llevaría el enlace público a una búsqueda
 * vacía. El residuo aceptado es que un parámetro de seguimiento que no esté aquí sobrevive.
 */
export const CAMPAIGN_PARAMS: ReadonlySet<string> = new Set([
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'trk',
  'trkcampaign',
]);

/** Los nombres se comparan en minúsculas: `UTM_SOURCE` es la misma campaña que `utm_source`. */
export function isCampaignParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(CAMPAIGN_PARAM_PREFIX) || CAMPAIGN_PARAMS.has(lower);
}
