import type {
  GroupLinkComment,
  NewGroupLinkComment,
} from '../../domain/group-link-comment';
import type { LinkCursor } from './link-listing';
import type { TransactionSession } from './transaction-session';

// Puerto de los comentarios de un link en un grupo (D2 de group-comments, ADR-026 §2). Se inyecta con
// `{ provide: GROUP_LINK_COMMENT_REPOSITORY, useClass: MongoGroupLinkCommentRepository }`. Solo tipos y el token.
//
// **No abre transacciones ni toca contadores.** El único dueño de `commentCount` y `commentsRevision`, y de las
// transacciones que tocan comentarios, es `GroupLinkRepository` (`addComment`, `removeComment`, `removeWithComments` y
// `deleteByGroup`): las escrituras de aquí reciben su sesión por parámetro. Este puerto solo lee por su cuenta.
//
// Ningún método lanza por un identificador mal formado: devuelven `null`, `false`, `0` o vacío.

export const GROUP_LINK_COMMENT_REPOSITORY = Symbol(
  'GROUP_LINK_COMMENT_REPOSITORY',
);

/** Página del hilo pedida: tamaño y, fuera de la primera, desde dónde seguir. */
export interface CommentListQuery {
  readonly limit: number;
  /** `(createdAt, _id)` del último comentario de la página anterior; el mismo cursor opaco que los listados de links. */
  readonly cursor?: LinkCursor;
}

/** Página del hilo, del más reciente al más antiguo. `nextCursor` solo viaja cuando hay más. */
export interface CommentPageSlice {
  readonly items: readonly GroupLinkComment[];
  readonly nextCursor?: LinkCursor;
}

export interface GroupLinkCommentRepository {
  /** Guarda el comentario con la sesión recibida y lo devuelve con su id. */
  insert(
    comment: NewGroupLinkComment,
    session: TransactionSession,
  ): Promise<GroupLinkComment>;
  /** Borra ese comentario de ese link en ese grupo con la sesión recibida; `false` si no estaba. */
  deleteOne(
    groupId: string,
    linkId: string,
    commentId: string,
    session: TransactionSession,
  ): Promise<boolean>;
  /** Borra todos los comentarios de un link en un grupo con la sesión recibida y devuelve cuántos. */
  deleteByRelation(
    groupId: string,
    linkId: string,
    session: TransactionSession,
  ): Promise<number>;
  /** Borra todos los comentarios de un grupo con la sesión recibida y devuelve cuántos. */
  deleteByGroup(groupId: string, session: TransactionSession): Promise<number>;
  /** Ese comentario de ese link en ese grupo; `null` si no está, es de otro link o grupo o algún id está mal formado. */
  find(
    groupId: string,
    linkId: string,
    commentId: string,
  ): Promise<GroupLinkComment | null>;
  /** Página del hilo por `(createdAt, _id)` descendentes. */
  page(
    groupId: string,
    linkId: string,
    query: CommentListQuery,
  ): Promise<CommentPageSlice>;
  /**
   * Los dos comentarios más recientes de cada uno de esos links en el grupo, del más reciente al más antiguo, en **una
   * sola consulta** (D7). Un link sin comentarios no aparece en el mapa.
   */
  latestByLinks(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Map<string, GroupLinkComment[]>>;
}
