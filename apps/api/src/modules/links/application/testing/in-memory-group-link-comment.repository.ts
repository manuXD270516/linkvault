import { isCommentId, isGroupId, isLinkId } from '../../domain/identifier';
import type {
  GroupLinkComment,
  NewGroupLinkComment,
} from '../../domain/group-link-comment';
import type {
  CommentListQuery,
  CommentPageSlice,
  GroupLinkCommentRepository,
} from '../ports/group-link-comment-repository.port';
import type { TransactionSession } from '../ports/transaction-session';

// Comentarios en memoria para tests de application (D12 de group-comments). No es un adaptador de producción: el real es
// `MongoGroupLinkCommentRepository`. Como él, no toca contadores ni abre transacciones —eso es de
// `InMemoryGroupLinkRepository`, el dueño—, ordena el hilo por `(createdAt, id)` descendentes y trata un identificador
// mal formado como "no está".

/** Cuántos comentarios lleva el resumen de la tarjeta. */
const LATEST_PER_LINK = 2;

export class InMemoryGroupLinkCommentRepository
  implements GroupLinkCommentRepository
{
  private readonly comments: GroupLinkComment[] = [];
  private nextId = 1;

  /** Sesión de la última escritura: un test comprueba que fue la de la transacción del dueño. */
  lastSession: TransactionSession | null = null;
  /** Llamadas a las lecturas, para el test de las lecturas fijas (D7). */
  findCalls = 0;
  pageCalls = 0;
  latestByLinksCalls = 0;

  /** Cuántos comentarios hay en total. */
  get size(): number {
    return this.comments.length;
  }

  /** Comentarios de un link en un grupo, en el orden en que se guardaron. */
  of(groupId: string, linkId: string): GroupLinkComment[] {
    return this.comments.filter(
      (comment) => comment.groupId === groupId && comment.linkId === linkId,
    );
  }

  insert(
    comment: NewGroupLinkComment,
    session: TransactionSession,
  ): Promise<GroupLinkComment> {
    this.lastSession = session;
    const stored: GroupLinkComment = { ...comment, id: this.nextCommentId() };
    this.comments.push(stored);
    return Promise.resolve(stored);
  }

  deleteOne(
    groupId: string,
    linkId: string,
    commentId: string,
    session: TransactionSession,
  ): Promise<boolean> {
    this.lastSession = session;
    return Promise.resolve(
      this.deleteWhere(
        (comment) =>
          comment.groupId === groupId &&
          comment.linkId === linkId &&
          comment.id === commentId,
      ) === 1,
    );
  }

  deleteByRelation(
    groupId: string,
    linkId: string,
    session: TransactionSession,
  ): Promise<number> {
    this.lastSession = session;
    return Promise.resolve(
      this.deleteWhere(
        (comment) => comment.groupId === groupId && comment.linkId === linkId,
      ),
    );
  }

  deleteByGroup(groupId: string, session: TransactionSession): Promise<number> {
    this.lastSession = session;
    return Promise.resolve(
      this.deleteWhere((comment) => comment.groupId === groupId),
    );
  }

  find(
    groupId: string,
    linkId: string,
    commentId: string,
  ): Promise<GroupLinkComment | null> {
    this.findCalls += 1;
    if (!isGroupId(groupId) || !isLinkId(linkId) || !isCommentId(commentId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      this.comments.find(
        (comment) =>
          comment.groupId === groupId &&
          comment.linkId === linkId &&
          comment.id === commentId,
      ) ?? null,
    );
  }

  page(
    groupId: string,
    linkId: string,
    query: CommentListQuery,
  ): Promise<CommentPageSlice> {
    this.pageCalls += 1;
    const after = query.cursor;
    const ordered = this.of(groupId, linkId).sort(newestFirst);
    const remaining =
      after === undefined
        ? ordered
        : ordered.filter(
            (comment) =>
              comment.createdAt.getTime() < after.date.getTime() ||
              (comment.createdAt.getTime() === after.date.getTime() &&
                comment.id < after.relationId),
          );
    const items = remaining.slice(0, query.limit);
    const last = items[items.length - 1];
    return Promise.resolve(
      remaining.length > items.length && last !== undefined
        ? {
            items,
            nextCursor: { date: last.createdAt, relationId: last.id },
          }
        : { items },
    );
  }

  latestByLinks(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Map<string, GroupLinkComment[]>> {
    this.latestByLinksCalls += 1;
    const latest = new Map<string, GroupLinkComment[]>();
    for (const linkId of new Set(linkIds)) {
      const comments = this.of(groupId, linkId).sort(newestFirst);
      if (comments.length > 0) {
        latest.set(linkId, comments.slice(0, LATEST_PER_LINK));
      }
    }
    return Promise.resolve(latest);
  }

  /** Alta directa para preparar un test, sin pasar por el dueño de los contadores. */
  seed(comment: NewGroupLinkComment): GroupLinkComment {
    const stored: GroupLinkComment = { ...comment, id: this.nextCommentId() };
    this.comments.push(stored);
    return stored;
  }

  private deleteWhere(matches: (comment: GroupLinkComment) => boolean): number {
    let deleted = 0;
    for (let index = this.comments.length - 1; index >= 0; index -= 1) {
      const comment = this.comments[index];
      if (comment !== undefined && matches(comment)) {
        this.comments.splice(index, 1);
        deleted += 1;
      }
    }
    return deleted;
  }

  private nextCommentId(): string {
    // Empieza por `c` para no coincidir nunca con los ids de las relaciones de los dobles, que empiezan por ceros.
    const id = `c${this.nextId.toString(16).padStart(23, '0')}`;
    this.nextId += 1;
    return id;
  }
}

/** Del más reciente al más antiguo y, a igual fecha, por id descendente, como el índice de Mongo. */
function newestFirst(a: GroupLinkComment, b: GroupLinkComment): number {
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  if (byDate !== 0) {
    return byDate;
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
