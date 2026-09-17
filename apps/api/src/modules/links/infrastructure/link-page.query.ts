import type { Model, PipelineStage, QueryFilter, Types } from 'mongoose';
import type {
  LinkListPage,
  LinkListQuery,
  ListedLink,
} from '../application/ports/link-listing';
import {
  JOB_LINKS_COLLECTION,
  toRelationObjectId,
  type JobLinkDocument,
} from './link.schemas';
import { toJobLink } from './mongo-job-link.repository';

// Listado paginado que comparten los links de un grupo y la lista privada (D8 de job-links). El orden es por fecha y, a
// igualdad, por `_id` de la relación, ambos descendentes, y va por los índices `(groupId, sharedAt, _id)` y
// `(userId, savedAt, _id)`. Se piden `limit + 1` filas para saber si hay siguiente página sin contar la colección; el
// `total` se cuenta aparte, porque no depende del tamaño de página.

/** Fila del listado tras unir la relación con su vacante. */
interface ListedRow {
  _id: Types.ObjectId;
  date: Date;
  sharedBy?: Types.ObjectId;
  link: JobLinkDocument;
}

/**
 * Página de relaciones con su vacante. `dateField` es `sharedAt` o `savedAt`; `withSharer` deja fuera a quien compartió
 * en la lista privada, donde no hay con quién compartir.
 */
export async function listLinkPage<D>(
  model: Model<D>,
  match: QueryFilter<D>,
  dateField: 'sharedAt' | 'savedAt',
  query: LinkListQuery,
  withSharer: boolean,
): Promise<LinkListPage> {
  const rows = await model
    .aggregate<ListedRow>([
      { $match: { ...match, ...cursorFilter(dateField, query) } },
      { $sort: { [dateField]: -1, _id: -1 } },
      { $limit: query.limit + 1 },
      {
        $lookup: {
          from: JOB_LINKS_COLLECTION,
          localField: 'linkId',
          foreignField: '_id',
          as: 'link',
        },
      },
      // Una relación cuya vacante ya no está no se muestra; hoy no puede pasar, porque el `JobLink` no se borra nunca.
      { $unwind: '$link' },
      {
        $project: {
          _id: 1,
          date: `$${dateField}`,
          link: 1,
          ...(withSharer ? { sharedBy: 1 } : {}),
        },
      },
    ])
    .exec();

  const page = rows.slice(0, query.limit);
  const items: ListedLink[] = page.map((row) => ({
    relationId: row._id.toHexString(),
    link: toJobLink(row.link),
    ...(row.sharedBy === undefined
      ? {}
      : { sharedBy: row.sharedBy.toHexString() }),
    sharedAt: row.date,
  }));
  const last = page[page.length - 1];
  return rows.length > page.length && last !== undefined
    ? {
        items,
        nextCursor: { date: last.date, relationId: last._id.toHexString() },
      }
    : { items };
}

/**
 * Filas estrictamente detrás del cursor: primero por fecha y, a igualdad, por `_id`. Sin el desempate, 50 links
 * guardados en el mismo instante harían que la paginación repitiera u omitiera filas.
 */
function cursorFilter(
  dateField: 'sharedAt' | 'savedAt',
  query: LinkListQuery,
): PipelineStage.Match['$match'] {
  const cursor = query.cursor;
  const after = cursor === undefined ? null : toRelationObjectId(cursor.relationId);
  if (cursor === undefined || after === null) {
    // Un cursor sin forma de identificador ya lo rechaza el caso de uso; aquí, simplemente, no hay por dónde seguir.
    return {};
  }
  return {
    $or: [
      { [dateField]: { $lt: cursor.date } },
      { [dateField]: cursor.date, _id: { $lt: after } },
    ],
  };
}
