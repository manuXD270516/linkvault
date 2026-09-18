import type { JobLinkSummary, LinkPage, LinkSharer } from '@linkvault/shared';
import type { JobLink } from '../domain/job-link';
import { encodeCursor } from './link-cursor';
import type { LinkListPage, ListedLink } from './ports/link-listing';

// Mapeo único a los contratos de la API. La URL normalizada viaja como identidad, pero lo que el SPA abre es
// `displayUrl` (D2). El preview no sale de aquí: en este change todo link está `pending`.

/**
 * Nombre que se muestra cuando el directorio no conoce a quien compartió. Defensa en profundidad: hoy no existe el
 * borrado de cuenta, así que no debería ocurrir.
 */
export const UNKNOWN_SHARER_NAME = 'Usuario';

/** Link con cómo llegó a la lista. `sharedBy` falta en la lista privada, donde no hay con quién compartir. */
export function toJobLinkSummary(
  link: JobLink,
  options: { sharedAt: Date; sharedBy?: LinkSharer },
): JobLinkSummary {
  return {
    id: link.id,
    normalizedUrl: link.normalizedUrl,
    displayUrl: link.displayUrl,
    platform: link.platform,
    previewStatus: link.previewStatus,
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
    ...(item.sharedBy === undefined
      ? {}
      : { sharedBy: toLinkSharer(item.sharedBy, names.get(item.sharedBy)) }),
  });
}
