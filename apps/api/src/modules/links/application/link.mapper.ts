import {
  PREVIEW_FIELD_NAMES,
  type JobLinkSummary,
  type LinkPage,
  type LinkSharer,
  type PreviewFieldName,
  type PreviewSources,
  type ResolvedPreviewSources,
} from '@linkvault/shared';
import type { JobLink } from '../domain/job-link';
import { encodeCursor } from './link-cursor';
import type { LinkListPage, ListedLink } from './ports/link-listing';

// Mapeo único a los contratos de la API. La URL normalizada viaja como identidad, pero lo que el SPA abre es
// `displayUrl` (D2).
//
// `previewRequestedAt` sale siempre, con respaldo en `createdAt`: los links guardados antes de `link-enrichment` no lo
// tienen, y sin él el SPA no podría distinguir un `pending` que se está leyendo de uno que se quedó colgado (D5). La
// fecha de alta es exactamente cuando se pidió su lectura por primera vez, así que el respaldo no miente.
//
// La procedencia sale con `by` resuelto a `{ userId, displayName }` (D4): la tarjeta dice "Escrito por Ana", no un
// identificador. Los nombres llegan ya resueltos en un `Map`, porque quien llama los pide **todos de una vez** para la
// página entera —`displayNameIdsOf`—; resolverlos aquí sería una consulta por campo manual.

/**
 * Nombre que se muestra cuando el directorio no conoce a quien compartió. Defensa en profundidad: hoy no existe el
 * borrado de cuenta, así que no debería ocurrir.
 */
export const UNKNOWN_SHARER_NAME = 'Usuario';

/** Cómo llegó el link a la lista y con qué nombres se resuelven los identificadores que salen en la respuesta. */
export interface SummaryContext {
  readonly sharedAt: Date;
  /** Falta en la lista privada, donde no hay con quién compartir. */
  readonly sharedBy?: LinkSharer;
  /** Nombres visibles ya resueltos; un id que no esté se responde como "Usuario". */
  readonly names?: Map<string, string>;
}

/** Link con cómo llegó a la lista. `sharedBy` falta en la lista privada, donde no hay con quién compartir. */
export function toJobLinkSummary(
  link: JobLink,
  options: SummaryContext,
): JobLinkSummary {
  const names = options.names ?? new Map<string, string>();
  return {
    id: link.id,
    normalizedUrl: link.normalizedUrl,
    displayUrl: link.displayUrl,
    platform: link.platform,
    previewStatus: link.previewStatus,
    previewVersion: link.previewVersion,
    ...(link.preview === undefined ? {} : { preview: link.preview }),
    ...(link.previewSources === undefined
      ? {}
      : { previewSources: toResolvedPreviewSources(link.previewSources, names) }),
    ...(link.lastEnrichmentError === undefined
      ? {}
      : { lastEnrichmentError: link.lastEnrichmentError }),
    previewRequestedAt: (
      link.previewRequestedAt ?? link.createdAt
    ).toISOString(),
    ...(options.sharedBy === undefined ? {} : { sharedBy: options.sharedBy }),
    sharedAt: options.sharedAt.toISOString(),
  };
}

/** Quien compartió, con el nombre que resolvió el directorio. */
export function toLinkSharer(
  userId: string,
  displayName: string | undefined,
): LinkSharer {
  return { userId, displayName: displayName ?? UNKNOWN_SHARER_NAME };
}

/**
 * Identificadores cuyo nombre visible hace falta para responder esos links: quien los compartió y quien escribió a mano
 * cualquiera de sus campos. Se piden **en una sola consulta** por página, no uno por campo ni uno por link.
 */
export function displayNameIdsOf(
  links: readonly JobLink[],
  sharedBy: readonly (string | undefined)[] = [],
): string[] {
  const ids = new Set<string>();
  for (const userId of sharedBy) {
    if (userId !== undefined) {
      ids.add(userId);
    }
  }
  for (const link of links) {
    for (const userId of manualAuthorIdsOf(link)) {
      ids.add(userId);
    }
  }
  return [...ids];
}

/** Quién escribió a mano algún campo de ese link. Vacío en un link que nadie ha tocado. */
function manualAuthorIdsOf(link: JobLink): string[] {
  const sources = link.previewSources;
  if (sources === undefined) {
    return [];
  }
  const ids: string[] = [];
  for (const field of PREVIEW_FIELD_NAMES) {
    const entry = sources[field];
    if (entry?.source === 'manual') {
      ids.push(entry.by);
    }
  }
  return ids;
}

/** Procedencia con `by` resuelto a `{ userId, displayName }`; lo automático sale tal cual. */
export function toResolvedPreviewSources(
  sources: PreviewSources,
  names: Map<string, string>,
): ResolvedPreviewSources {
  const resolved: ResolvedPreviewSources = {};
  for (const field of PREVIEW_FIELD_NAMES) {
    const entry = sources[field];
    if (entry === undefined) {
      continue;
    }
    // El campo se escribe uno a uno porque cada uno tiene el tipo de su valor: un `Record` genérico lo perdería.
    assignResolved(resolved, field, entry, names);
  }
  return resolved;
}

/**
 * Copia la entrada de un campo resolviendo el autor si es manual. El `as never` acota a este punto la pérdida de tipo
 * que supone recorrer los campos por nombre: fuera de aquí, `ResolvedPreviewSources` sigue tipado campo a campo.
 */
function assignResolved(
  resolved: ResolvedPreviewSources,
  field: PreviewFieldName,
  entry: NonNullable<PreviewSources[PreviewFieldName]>,
  names: Map<string, string>,
): void {
  resolved[field] =
    entry.source === 'manual'
      ? ({
          ...entry,
          by: toLinkSharer(entry.by, names.get(entry.by)),
        } as never)
      : (entry as never);
}

/**
 * Página del listado con su `total`, que es el de la lista entera y no depende del tamaño de página. El cursor se
 * codifica aquí: fuera de `links` nadie sabe de qué está hecho.
 */
export function toLinkPage(
  page: LinkListPage,
  total: number,
  names: Map<string, string>,
): LinkPage {
  const items = page.items.map((item) => toListedSummary(item, names));
  return {
    items,
    total,
    ...(page.nextCursor === undefined
      ? {}
      : { nextCursor: encodeCursor(page.nextCursor) }),
  };
}

function toListedSummary(
  item: ListedLink,
  names: Map<string, string>,
): JobLinkSummary {
  return toJobLinkSummary(item.link, {
    sharedAt: item.sharedAt,
    names,
    ...(item.sharedBy === undefined
      ? {}
      : { sharedBy: toLinkSharer(item.sharedBy, names.get(item.sharedBy)) }),
  });
}
