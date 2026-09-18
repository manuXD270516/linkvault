import type { ListLinksQuery } from '@linkvault/shared';
import { InvalidCursor } from '../domain/errors';
import { isLinkId } from '../domain/identifier';
import type { LinkCursor, LinkListQuery } from './ports/link-listing';

// Cursor de paginación de los dos listados (D8 de job-links). Es opaco a propósito: el SPA lo devuelve tal cual y no
// puede construirlo, así que la forma interna —la fecha y el `_id` de la relación— se puede cambiar sin romper a nadie.
// La fecha sola no basta: importar 50 links deja 50 relaciones en el mismo instante, y sin el desempate por `_id` la
// paginación repetiría u omitiría filas.

/** Separador imposible dentro de una fecha ISO o de un ObjectId. */
const SEPARATOR = '|';

/** Cursor opaco que viaja por HTTP: base64url de `<fecha ISO>|<id de la relación>`. */
export function encodeCursor(cursor: LinkCursor): string {
  const plain = `${cursor.date.toISOString()}${SEPARATOR}${cursor.relationId}`;
  return Buffer.from(plain, 'utf8').toString('base64url');
}

/**
 * Cursor recibido. Uno manipulado, de otra forma o con una fecha imposible rechaza con `InvalidCursor`, que nombra
 * `cursor` en la respuesta: nunca se ignora en silencio, porque devolver la primera página parecería que faltan links.
 */
export function decodeCursor(raw: string): LinkCursor {
  const plain = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = plain.indexOf(SEPARATOR);
  if (separator === -1) {
    throw new InvalidCursor();
  }
  const date = new Date(plain.slice(0, separator));
  const relationId = plain.slice(separator + 1);
  if (Number.isNaN(date.getTime()) || !isLinkId(relationId)) {
    throw new InvalidCursor();
  }
  return { date, relationId };
}

/** Query del contrato HTTP (límite y cursor opaco) traducida a la que entienden los repositorios. */
export function toLinkListQuery(query: ListLinksQuery): LinkListQuery {
  return {
    limit: query.limit,
    ...(query.cursor === undefined
      ? {}
      : { cursor: decodeCursor(query.cursor) }),
  };
}
