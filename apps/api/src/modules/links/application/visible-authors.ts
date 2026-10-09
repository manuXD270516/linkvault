import type { GroupMembership } from './ports/group-membership.port';

// Quién puede ver el nombre de quién (H1 de usage-guide-fixes; ADR-055 §2). La procedencia por campo guarda el autor de
// lo que se escribió o pegó, pero `users/profile` solo deja ver el `displayName` de otra persona a quien comparte algún
// grupo con ella. Este ayudante calcula, para quien lee, el conjunto de autores cuyo nombre puede salir.
//
// `VisibleAuthors` es un tipo con marca que solo construyen las dos funciones de este módulo: ningún caso de uso puede
// pasar un `new Set(...)` a mano al mapeo. Falla cerrado (un conjunto vacío oculta a todos) y no tiene respaldo: si
// `peersAmong` falla, la excepción se propaga y la petición falla como cualquier otra lectura.

declare const visibleAuthorsBrand: unique symbol;

/** Identificadores de los autores cuyo nombre puede ver quien lee. Solo lo construyen los ayudantes de este fichero. */
export type VisibleAuthors = ReadonlySet<string> & {
  readonly [visibleAuthorsBrand]: true;
};

function brand(ids: Set<string>): VisibleAuthors {
  return ids as unknown as VisibleAuthors;
}

/**
 * Autores visibles para `viewerId` de entre `candidateIds`: él mismo y quienes comparten con él algún grupo. Con
 * candidatos vacíos o solo él mismo no hace ninguna consulta; si no, hace exactamente una.
 */
export async function visibleAuthorsFor(
  membership: GroupMembership,
  viewerId: string,
  candidateIds: readonly string[],
): Promise<VisibleAuthors> {
  const visible = new Set<string>([viewerId]);
  const foreign = [...new Set(candidateIds)].filter((id) => id !== viewerId);
  if (foreign.length === 0) {
    return brand(visible);
  }
  for (const peer of await membership.peersAmong(viewerId, foreign)) {
    visible.add(peer);
  }
  return brand(visible);
}

/**
 * Autores visibles para cada destinatario de un aviso: una consulta por autor distinto (los destinatarios que comparten
 * grupo con él), ninguna si no hay autores. El conjunto de cada destinatario son los autores con los que comparte grupo
 * más él mismo si es autor.
 */
export async function visibleAuthorsByRecipient(
  membership: GroupMembership,
  authorIds: readonly string[],
  recipientIds: readonly string[],
): Promise<Map<string, VisibleAuthors>> {
  const recipients = [...new Set(recipientIds)];
  const sets = new Map<string, Set<string>>(
    recipients.map((recipient) => [recipient, new Set<string>()]),
  );
  for (const author of new Set(authorIds)) {
    sets.get(author)?.add(author);
    const others = recipients.filter((recipient) => recipient !== author);
    if (others.length === 0) {
      continue;
    }
    for (const peer of await membership.peersAmong(author, others)) {
      sets.get(peer)?.add(author);
    }
  }
  return new Map(
    [...sets].map(([recipient, ids]) => [recipient, brand(ids)] as const),
  );
}
