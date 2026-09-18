import type { LinkListPage, LinkListQuery } from './link-listing';
import type { TransactionSession } from './transaction-session';

// Puerto de la relación entre un grupo y una vacante (D1 y D4 de job-links). Un link puede estar en varios grupos y un
// grupo tiene cada link una sola vez, garantizado por el índice único `(groupId, linkId)`. Solo tipos y el token.

export const GROUP_LINK_REPOSITORY = Symbol('GROUP_LINK_REPOSITORY');

/** Link compartido en un grupo. `sharedBy` es quien lo compartió primero y no cambia. */
export interface GroupLink {
  readonly groupId: string;
  readonly linkId: string;
  readonly sharedBy: string;
  readonly sharedAt: Date;
}

/** Relación tras compartir, y si la creó esta petición o ya estaba. */
export interface SharedGroupLink {
  readonly relation: GroupLink;
  readonly created: boolean;
}

export interface ShareInGroupInput {
  readonly groupId: string;
  readonly linkId: string;
  readonly sharedBy: string;
  readonly sharedAt: Date;
}

export interface GroupLinkRepository {
  /**
   * Comparte el link en el grupo. Idempotente: si ya estaba devuelve la relación existente con `created` `false`, sin
   * cambiar quién lo compartió primero. Se llama dentro de la transacción del alta.
   */
  share(
    input: ShareInGroupInput,
    session: TransactionSession,
  ): Promise<SharedGroupLink>;
  /** Relación concreta; `null` si el link no está en ese grupo o algún id está mal formado. */
  find(groupId: string, linkId: string): Promise<GroupLink | null>;
  /**
   * Grupos donde está ese link, con quién lo compartió y cuándo. Una sola consulta por el índice `{ linkId: 1 }`: es la
   * mitad del reparto de un aviso de enriquecimiento (D9 de link-enrichment).
   */
  relationsOfLink(linkId: string): Promise<GroupLink[]>;
  /** Página de links del grupo, por `sharedAt` y `_id` descendentes. */
  listByGroup(groupId: string, query: LinkListQuery): Promise<LinkListPage>;
  /** Cuántos links tiene el grupo. No depende del tamaño de página. */
  countByGroup(groupId: string): Promise<number>;
  /**
   * De los grupos indicados, cuáles tienen ya ese link. Una sola consulta: es lo que evita el N+1 de `alreadyInGroups`
   * (D4).
   */
  groupsWithLink(
    groupIds: readonly string[],
    linkId: string,
  ): Promise<Set<string>>;
  /** Quita el link del grupo; `false` si no estaba. NUNCA borra el `JobLink`. */
  remove(groupId: string, linkId: string): Promise<boolean>;
  /**
   * Borra todas las relaciones del grupo y devuelve cuántas. La usa el hook del borrado de grupo, dentro de la
   * transacción de `groups` (D7b).
   */
  deleteByGroup(groupId: string, session: TransactionSession): Promise<number>;
  /** Borra las relaciones de un link con cualquier grupo y devuelve cuántas. */
  deleteByLink(linkId: string): Promise<number>;
}
