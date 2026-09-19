import type {
  GroupLinkComment,
  NewGroupLinkComment,
} from '../../domain/group-link-comment';
import type { ShareNote } from '../../domain/share-note';
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
  /** Nota de quien lo compartió, si la dejó al crear la relación y nadie la quitó (D3 de group-comments). */
  readonly note?: ShareNote;
  /** Comentarios del link en este grupo; 0 si el documento no tiene el campo (D2 de group-comments). */
  readonly commentCount: number;
  /** Revisión del resumen de comentarios: sube con cada alta y cada borrado, nunca baja mientras dure la relación. */
  readonly commentsRevision: number;
}

/**
 * Contadores de comentarios de la relación tras un alta o un borrado. `sharedAt` identifica la relación: al quitar el
 * link y volver a compartirlo, la revisión vuelve a 0 con otro `sharedAt` (critic 2 de la iteración 2).
 */
export interface CommentsCounters {
  readonly count: number;
  readonly revision: number;
  readonly sharedAt: Date;
}

/** Comentario recién guardado y los contadores de la relación tras guardarlo. */
export interface AddedComment {
  readonly comment: GroupLinkComment;
  readonly counters: CommentsCounters;
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
  /** Nota de quien comparte. Solo se guarda si la relación es nueva: la del primero no cambia. */
  readonly note?: ShareNote;
}

export interface GroupLinkRepository {
  /**
   * Comparte el link en el grupo. Idempotente: si ya estaba devuelve la relación existente con `created` `false`, sin
   * cambiar quién lo compartió primero ni su nota. Se llama dentro de la transacción del alta.
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
  /**
   * Página de links del grupo, por `sharedAt` y `_id` descendentes, con la nota y los contadores de comentarios de
   * cada relación.
   */
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
  /**
   * De los links indicados, cuáles están compartidos en el grupo. Una sola consulta por el índice único
   * `(groupId, linkId)`: es la segunda lectura fija de los estados compartidos de un grupo (D6 de
   * applications-tracking). Los ids mal formados no aportan nada.
   */
  linkIdsIn(groupId: string, linkIds: readonly string[]): Promise<Set<string>>;
  /**
   * Quita el link del grupo **con su nota y sus comentarios**, en una transacción (D2 y D8 de group-comments): o se
   * borra todo o nada. `false` si la relación no estaba. NUNCA borra el `JobLink`.
   */
  removeWithComments(groupId: string, linkId: string): Promise<boolean>;
  /**
   * Borra todas las relaciones del grupo y, antes, sus comentarios, con la sesión recibida, y devuelve cuántas
   * relaciones. La usa el hook del borrado de grupo, dentro de la transacción de `groups` (D7b de job-links, D8 de
   * group-comments).
   */
  deleteByGroup(groupId: string, session: TransactionSession): Promise<number>;
  /**
   * Guarda un comentario en una transacción (D2 de group-comments): primero `$inc` de `commentCount` y
   * `commentsRevision` en la relación y después el comentario. `null` si la relación ya no existe, sin guardar nada:
   * un comentario nunca queda sin su relación, tampoco en la carrera con `removeWithComments`.
   */
  addComment(comment: NewGroupLinkComment): Promise<AddedComment | null>;
  /**
   * Borra un comentario en una transacción: primero el comentario y, solo si se borró, `$inc` de `-1` en
   * `commentCount` y `+1` en `commentsRevision`. `null` si el comentario no estaba (otro borrado se adelantó).
   */
  removeComment(
    groupId: string,
    linkId: string,
    commentId: string,
  ): Promise<CommentsCounters | null>;
  /** Quita la nota de la relación, la hubiera o no; `false` si la relación no existe. */
  clearNote(groupId: string, linkId: string): Promise<boolean>;
}
