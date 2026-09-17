import type {
  LinkListPage,
  LinkListQuery,
  ListedLink,
} from '../ports/link-listing';
import type { InMemoryJobLinkRepository } from './in-memory-job-link.repository';

// Paginación de los dobles en memoria: el mismo orden y el mismo desempate que los índices de Mongo
// (`(groupId, sharedAt, _id)` y `(userId, savedAt, _id)`), para que un caso de uso probado aquí recorra las páginas
// igual que en producción.

/** Lo mínimo que comparten una relación de grupo y una entrada privada para ordenarse. */
export interface StoredRelation {
  readonly relationId: string;
  readonly linkId: string;
  readonly date: Date;
}

/**
 * Página de relaciones ya filtradas por su lista: por fecha y, a igualdad, por el id de la relación, ambos
 * descendentes. Se pide una fila de más para saber si hay siguiente sin contar la colección entera.
 */
export async function pageOf<T extends StoredRelation>(
  relations: readonly T[],
  query: LinkListQuery,
  links: InMemoryJobLinkRepository,
  sharerOf: (relation: T) => string | undefined,
): Promise<LinkListPage> {
  const ordered = [...relations].sort(byDateThenIdDescending);
  const after = query.cursor;
  const remaining =
    after === undefined
      ? ordered
      : ordered.filter(
          (relation) =>
            relation.date.getTime() < after.date.getTime() ||
            (relation.date.getTime() === after.date.getTime() &&
              relation.relationId < after.relationId),
        );
  const page = remaining.slice(0, query.limit);
  const items: ListedLink[] = [];
  for (const relation of page) {
    const link = await links.findById(relation.linkId);
    if (link === null) {
      continue;
    }
    const sharedBy = sharerOf(relation);
    items.push({
      relationId: relation.relationId,
      link,
      ...(sharedBy === undefined ? {} : { sharedBy }),
      sharedAt: relation.date,
    });
  }
  const last = page[page.length - 1];
  return remaining.length > page.length && last !== undefined
    ? { items, nextCursor: { date: last.date, relationId: last.relationId } }
    : { items };
}

function byDateThenIdDescending(a: StoredRelation, b: StoredRelation): number {
  const byDate = b.date.getTime() - a.date.getTime();
  if (byDate !== 0) {
    return byDate;
  }
  return a.relationId < b.relationId ? 1 : a.relationId > b.relationId ? -1 : 0;
}
