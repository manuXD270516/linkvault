import {
  PREVIEW_FIELD_NAMES,
  type CommentsSummary,
  type JobLinkSummary,
  type KnowSomeoneState,
  type LinkPage,
  type LinkSharer,
  type PreviewFieldName,
  type PreviewSources,
  type PublicShare as PublicShareView,
  type ResolvedPreviewSources,
  type ShareNote,
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
// La procedencia sale con `by` resuelto a `{ userId, displayName }` (D4; D3 de paste-job-description): la tarjeta dice
// "Escrito por Ana" o "Descripción pegada por Beto", no un identificador, y lo mismo el autor de lo que guarda
// `replaced`. Los nombres llegan ya resueltos en un `Map`, porque quien llama los pide **todos de una vez** para la
// página entera —`displayNameIdsOf`—; resolverlos aquí sería una consulta por campo.

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
  /** Nota de quien lo compartió; solo en un grupo y solo si la tiene (D3 de group-comments). */
  readonly note?: ShareNote;
  /** Resumen de sus comentarios en el grupo; solo en el listado de un grupo (D7 de group-comments). */
  readonly comments?: CommentsSummary;
  /**
   * Enlace público de la relación con el grupo, si lo tiene (D1 de public-preview-share). Solo en el listado de un
   * grupo y en la respuesta de guardar en uno: la lista privada NO lo lleva nunca.
   */
  readonly publicShare?: PublicShareView;
  /**
   * Flag know-someone (D3 de know-someone-flag). Solo en el listado de un grupo: **siempre** presente ahí. La lista
   * privada NO lo lleva nunca.
   */
  readonly knowSomeone?: KnowSomeoneState;
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
      : {
          previewSources: toResolvedPreviewSources(link.previewSources, names),
        }),
    ...(link.lastEnrichmentError === undefined
      ? {}
      : { lastEnrichmentError: link.lastEnrichmentError }),
    previewRequestedAt: (
      link.previewRequestedAt ?? link.createdAt
    ).toISOString(),
    ...(link.closedAt === undefined
      ? {}
      : { closedAt: link.closedAt.toISOString() }),
    ...(link.closedReason === undefined
      ? {}
      : { closedReason: link.closedReason }),
    ...(options.sharedBy === undefined ? {} : { sharedBy: options.sharedBy }),
    sharedAt: options.sharedAt.toISOString(),
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.comments === undefined ? {} : { comments: options.comments }),
    ...(options.publicShare === undefined
      ? {}
      : { publicShare: options.publicShare }),
    ...(options.knowSomeone === undefined
      ? {}
      : { knowSomeone: options.knowSomeone }),
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
 * Identificadores cuyo nombre visible hace falta para responder esos links: quien los compartió, quien escribió a mano o
 * pegó cualquiera de sus campos y quien firmaba lo que esos campos guardan para deshacerse. Se piden **en una sola
 * consulta** por página, no uno por campo ni uno por link.
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
    for (const userId of authorIdsOf(link)) {
      ids.add(userId);
    }
  }
  return [...ids];
}

/**
 * Quién escribió a mano o pegó algún campo de ese link, incluido el autor de la entrada que cada campo guarda en
 * `replaced`. Vacío en un link que nadie ha tocado.
 */
function authorIdsOf(link: JobLink): string[] {
  const sources = link.previewSources;
  if (sources === undefined) {
    return [];
  }
  const ids: string[] = [];
  for (const field of PREVIEW_FIELD_NAMES) {
    const entry = sources[field];
    if (entry === undefined || entry.source === 'auto') {
      continue;
    }
    ids.push(entry.by);
    if (entry.replaced !== undefined && entry.replaced.source !== 'auto') {
      ids.push(entry.replaced.by);
    }
  }
  return ids;
}

/** Lo que un campo escrito por una persona guarda para deshacerse, tal y como se guarda. */
type DisplacedEntry = NonNullable<
  Extract<
    NonNullable<PreviewSources[PreviewFieldName]>,
    { source: 'manual' | 'pasted' }
  >['replaced']
>;

/** Procedencia con todo `by` resuelto a `{ userId, displayName }`, también el de `replaced`; lo automático sale tal cual. */
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
 * Copia la entrada de un campo resolviendo su autor —si la escribió o pegó una persona— y el de la entrada que guarda
 * en `replaced`. El `as never` acota a este punto la pérdida de tipo que supone recorrer los campos por nombre: fuera de
 * aquí, `ResolvedPreviewSources` sigue tipado campo a campo.
 */
function assignResolved(
  resolved: ResolvedPreviewSources,
  field: PreviewFieldName,
  entry: NonNullable<PreviewSources[PreviewFieldName]>,
  names: Map<string, string>,
): void {
  if (entry.source === 'auto') {
    resolved[field] = entry as never;
    return;
  }
  const { replaced, ...rest } = entry;
  resolved[field] = {
    ...rest,
    by: toLinkSharer(entry.by, names.get(entry.by)),
    ...(replaced === undefined
      ? {}
      : { replaced: resolveDisplaced(replaced, names) }),
  } as never;
}

/** La entrada desplazada con su autor resuelto; la que salió de la página no tiene autor y sale tal cual. */
function resolveDisplaced(
  replaced: DisplacedEntry,
  names: Map<string, string>,
): unknown {
  return replaced.source === 'auto'
    ? replaced
    : { ...replaced, by: toLinkSharer(replaced.by, names.get(replaced.by)) };
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
