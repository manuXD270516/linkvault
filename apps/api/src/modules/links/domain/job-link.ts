import type {
  LastEnrichmentError,
  Platform,
  PreviewSources,
  PreviewStatus,
  StoredPreview,
} from '@linkvault/shared';
import type { Canonicalization } from './canonicalizers/canonicalizer';

// `JobLink` (D1 de job-links): la vacante como entidad única de LinkVault. La misma oferta compartida con URLs distintas
// es un solo documento, identificado por `dedupeKey`, que un índice único garantiza. El preview lo rellena
// `link-enrichment`; aquí un link nace siempre `pending`.

/** URLs originales que se conservan como máximo (spec links/job-link). */
export const MAX_ORIGINAL_URLS = 20;

/** Versión de preview de un link recién creado. La sube quien vuelva a enriquecerlo. */
export const INITIAL_PREVIEW_VERSION = 1;

export interface JobLink {
  readonly id: string;
  /** Solo identidad: no se abre ni se descarga (D2). */
  readonly normalizedUrl: string;
  readonly urlHash: string;
  /** `<platform>:<externalJobId>` o `url:<urlHash>`; única entre todos los links. */
  readonly dedupeKey: string;
  readonly platform: Platform;
  readonly externalJobId?: string;
  /**
   * URL que se abre y que `link-enrichment` descargará: la primera que escribió una persona. Inmutable (se fija con
   * `$setOnInsert`), para que recortar el historial no cambie el enlace que el SPA abre (D1).
   */
  readonly displayUrl: string;
  /** Historial de URLs tal y como las escribieron las personas: las 20 últimas. */
  readonly originalUrls: readonly string[];
  readonly previewStatus: PreviewStatus;
  readonly previewVersion: number;
  /** Vacante leída de la página. Ausente mientras nadie la haya leído; nunca completa del todo (`storedPreview`). */
  readonly preview?: StoredPreview;
  /** Quién puso cada campo del preview: el extractor que lo produjo o la persona que lo escribió a mano (D4). */
  readonly previewSources?: PreviewSources;
  /** Motivo del último fallo de lectura. Nunca lleva el cuerpo de la respuesta ni la URL del usuario (D5). */
  readonly lastEnrichmentError?: LastEnrichmentError;
  /**
   * Cuándo se pidió leer la oferta: el alta y cada reintento la apuntan. Sin ella, un `pending` no distingue "se está
   * leyendo" de "se quedó colgado con el relay caído" (D5). Ausente en los links guardados antes de `link-enrichment`.
   */
  readonly previewRequestedAt?: Date;
  /**
   * Cuándo se marcó la vacante como cerrada (ADR-037). Ausente = abierta. Ortogonal a `previewStatus`.
   */
  readonly closedAt?: Date;
  readonly closedReason?: 'calendar' | 'recheck';
  /** Última pasada del detector/re-check de frescura (solo persistencia; no va al summary HTTP). */
  readonly lastFreshnessCheckAt?: Date;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Link aún no guardado: el repositorio le asigna el id. */
export type NewJobLink = Omit<JobLink, 'id'>;

/**
 * Clave de dedupe (ADR-008): `platform:externalJobId` cuando la canonicalización reconoce la vacante y `url:<urlHash>`
 * cuando no. Una sola clave para los dos casos deja un único índice único, sin índices parciales que compitan (D1).
 */
export function dedupeKeyOf(
  canonicalization: Canonicalization,
  urlHash: string,
): string {
  const { platform, externalJobId } = canonicalization;
  return externalJobId === undefined
    ? `url:${urlHash}`
    : `${platform}:${externalJobId}`;
}

/** Alta de un link: nace `pending`, con la URL que escribió quien lo guardó como única original. */
export function createJobLink(params: {
  normalizedUrl: string;
  urlHash: string;
  canonicalization: Canonicalization;
  displayUrl: string;
  createdBy: string;
  now: Date;
}): NewJobLink {
  const { canonicalization } = params;
  return {
    normalizedUrl: params.normalizedUrl,
    urlHash: params.urlHash,
    dedupeKey: dedupeKeyOf(canonicalization, params.urlHash),
    platform: canonicalization.platform,
    ...(canonicalization.externalJobId === undefined
      ? {}
      : { externalJobId: canonicalization.externalJobId }),
    displayUrl: params.displayUrl,
    originalUrls: [params.displayUrl],
    previewStatus: 'pending',
    previewVersion: INITIAL_PREVIEW_VERSION,
    previewRequestedAt: params.now,
    createdBy: params.createdBy,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

/**
 * Historial con una URL más, si no estaba ya, conservando las 20 últimas (el `$slice: -20` del upsert). El tope no es
 * cosmético: sin él, una plataforma reconocida con un parámetro aleatorio haría crecer el array hasta los 16 MB del
 * documento y lo dejaría inescribible (D3). Recortar no toca `displayUrl`, que es un campo propio e inmutable.
 */
export function appendOriginalUrl(
  originalUrls: readonly string[],
  url: string,
): readonly string[] {
  if (originalUrls.includes(url)) {
    return originalUrls;
  }
  return [...originalUrls, url].slice(-MAX_ORIGINAL_URLS);
}

/** Link con la URL original añadida. Si ya estaba, devuelve el mismo link sin tocar `updatedAt`. Nunca cambia `displayUrl`. */
export function withOriginalUrl(
  link: JobLink,
  url: string,
  now: Date,
): JobLink {
  const originalUrls = appendOriginalUrl(link.originalUrls, url);
  return originalUrls === link.originalUrls
    ? link
    : { ...link, originalUrls, updatedAt: now };
}

/** Host de una URL (con su puerto, como lo compara el worker), o `null` si no es una dirección. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Si volver a guardar la vacante con `url` —una URL que **no estaba** en su historial— debe pedir una lectura nueva (D7
 * de paste-job-description): solo cuando el link está en `failed` porque `robots.txt` prohíbe su `displayUrl` y la URL
 * nueva es **del mismo host**. Es el disparador del rescate por historial: `robots_disallowed` no se reintenta, así que
 * sin esto la cadena que prueba las demás URLs no se ejecutaría nunca. Una URL de otro host no pide nada, porque esa
 * cadena no la probaría: su turno y su `Crawl-delay` son otros.
 */
export function asksForHistoryRescue(link: JobLink, url: string): boolean {
  if (
    link.previewStatus !== 'failed' ||
    link.lastEnrichmentError?.reason !== 'robots_disallowed' ||
    url === link.displayUrl
  ) {
    return false;
  }
  const host = hostOf(link.displayUrl);
  return host !== null && hostOf(url) === host;
}
