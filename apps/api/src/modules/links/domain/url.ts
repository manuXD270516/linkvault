import { createHash } from 'node:crypto';

// Normalización de URL (D2 de job-links). La URL normalizada es SOLO identidad: forzar `https` o quitar `ref`/`trk`
// puede producir una URL que no resuelve, así que lo que el SPA abre y lo que `link-enrichment` descargará es
// `displayUrl`, la primera URL que escribió una persona. Aquí no se juzga la longitud: eso es `limits.ts`.

/** Esquemas que identifican una vacante. Cualquier otro (`ftp:`, `javascript:`…) no se reconoce. */
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

/** Prefijo de los parámetros de campaña de Google Analytics (`utm_source`, `utm_medium`…). */
const CAMPAIGN_PARAM_PREFIX = 'utm_';

/**
 * Parámetros de campaña y de seguimiento que se descartan (spec links/job-link). Lista cerrada y en minúsculas: quitar
 * cualquier parámetro desconocido fundiría vacantes distintas que solo se diferencian por un parámetro de verdad
 * (`jk`, `currentJobId`…).
 */
const CAMPAIGN_PARAMS: ReadonlySet<string> = new Set([
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'trk',
  'trkcampaign',
]);

/** Identidad de una URL: su forma normalizada y el hash que la deduplica cuando no hay `externalJobId`. */
export interface NormalizedUrl {
  readonly normalizedUrl: string;
  readonly urlHash: string;
}

/** URL tal y como la escribió una persona, sin espacios exteriores. Es la que se abre y la que se descarga. */
export function toDisplayUrl(raw: string): string {
  return raw.trim();
}

/**
 * URL normalizada para identidad y su hash, o `null` si no es `http(s)`, no tiene host o no es una URL. Un `null` se
 * cuenta como no reconocida: el caso de uso responde `invalid_url` y la importación la suma a `unrecognized`.
 */
export function normalizeUrl(raw: string): NormalizedUrl | null {
  const url = parseSupportedUrl(raw);
  if (url === null) {
    return null;
  }
  const normalizedUrl = serializeIdentity(url);
  return { normalizedUrl, urlHash: urlHashOf(normalizedUrl) };
}

/** `sha256` en hexadecimal de la URL normalizada. Estable ante el orden de los parámetros, que la normalización ordena. */
export function urlHashOf(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

/** URL analizada si es `http(s)` y tiene host; `null` en cualquier otro caso, incluida una cadena que no es una URL. */
function parseSupportedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!SUPPORTED_PROTOCOLS.has(url.protocol) || url.hostname === '') {
    return null;
  }
  return url;
}

/**
 * Forma canónica: `https`, host en minúsculas y sin `www.`, sin credenciales, sin fragmento, sin barra final salvo en la
 * raíz y con los parámetros que sobreviven ordenados. El esquema y el host ya llegan en minúsculas de `URL`.
 */
function serializeIdentity(url: URL): string {
  const host = url.host.startsWith('www.') ? url.host.slice(4) : url.host;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const query = identityQuery(url);
  return `https://${host}${path}${query === '' ? '' : `?${query}`}`;
}

/** Parámetros sin los de campaña, ordenados por nombre y, a igualdad, por valor, para que el hash no dependa del orden. */
function identityQuery(url: URL): string {
  const params = [...url.searchParams].filter(
    ([name]) => !isCampaignParam(name),
  );
  params.sort(([nameA, valueA], [nameB, valueB]) =>
    nameA === nameB ? compare(valueA, valueB) : compare(nameA, nameB),
  );
  return new URLSearchParams(params).toString();
}

/** Los nombres de parámetro se comparan en minúsculas: `UTM_SOURCE` es la misma campaña que `utm_source`. */
function isCampaignParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(CAMPAIGN_PARAM_PREFIX) || CAMPAIGN_PARAMS.has(lower);
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
