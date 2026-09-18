import { LinkNotFound } from '../domain/errors';
import type { JobLink } from '../domain/job-link';
import type { GroupLinkRepository } from './ports/group-link-repository.port';
import type { GroupMembership } from './ports/group-membership.port';
import type { JobLinkRepository } from './ports/job-link-repository.port';
import type { UserLinkRepository } from './ports/user-link-repository.port';

// Permiso de lectura de un link, compartido por la edición del preview y el reintento de su lectura. Ver un link es
// tenerlo en la lista privada o compartir con él un grupo del que se es miembro; quien no lo ve recibe `link_not_found`,
// igual que si no existiera, para que un extraño no pueda comprobar qué ofertas hay guardadas probando identificadores.
//
// Devuelve además **por dónde** lo ve, porque la respuesta se compone con el contrato de un link de una lista, que lleva
// cuándo llegó ahí y quién lo compartió. La lista privada va primero: es lo de la propia persona.

/** Puertos que necesita la comprobación. Se pasan juntos para no repetir el cableado en cada caso de uso. */
export interface LinkReaders {
  readonly links: JobLinkRepository;
  readonly groupLinks: GroupLinkRepository;
  readonly userLinks: UserLinkRepository;
  readonly membership: GroupMembership;
}

/** Link visible para alguien y la relación por la que lo ve. */
export interface ReadableLink {
  readonly link: JobLink;
  /** `savedAt` en la lista privada, `sharedAt` en un grupo. */
  readonly sharedAt: Date;
  /** Quién lo compartió; ausente cuando se ve por la lista privada. */
  readonly sharedBy?: string;
}

/**
 * Link que esa persona puede ver, o `LinkNotFound`. Un identificador mal formado y un link de un grupo ajeno responden
 * lo mismo que uno inexistente.
 */
export async function requireReadableLink(
  readers: LinkReaders,
  userId: string,
  linkId: string,
): Promise<ReadableLink> {
  const link = await readers.links.findById(linkId);
  if (link === null) {
    throw new LinkNotFound();
  }
  const personal = await readers.userLinks.find(userId, linkId);
  if (personal !== null) {
    return { link, sharedAt: personal.savedAt };
  }
  const myGroups = await readers.membership.groupsOf(userId);
  if (myGroups.length === 0) {
    throw new LinkNotFound();
  }
  // Una sola consulta para todos sus grupos: comprobar uno a uno sería un N+1 con quien está en veinte grupos (D4).
  const withLink = await readers.groupLinks.groupsWithLink(
    myGroups.map((group) => group.groupId),
    linkId,
  );
  const groupId = myGroups
    .map((group) => group.groupId)
    .find((candidate) => withLink.has(candidate));
  if (groupId === undefined) {
    throw new LinkNotFound();
  }
  const relation = await readers.groupLinks.find(groupId, linkId);
  if (relation === null) {
    throw new LinkNotFound();
  }
  return {
    link,
    sharedAt: relation.sharedAt,
    sharedBy: relation.sharedBy,
  };
}
