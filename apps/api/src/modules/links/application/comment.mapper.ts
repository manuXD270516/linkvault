import type {
  CommentPage,
  CommentsSummary,
  GroupLinkComment as GroupLinkCommentView,
  ShareNote as ShareNoteView,
} from '@linkvault/shared';
import {
  authorLeftGiven,
  type GroupLinkComment,
} from '../domain/group-link-comment';
import type { ShareNote } from '../domain/share-note';
import { encodeCursor } from './link-cursor';
import { toLinkSharer } from './link.mapper';
import type { CommentPageSlice } from './ports/group-link-comment-repository.port';
import type { CommentsCounters } from './ports/group-link-repository.port';

// Mapeo de comentarios y notas a los contratos de la API (D7 y D10 de group-comments). Los nombres visibles y la
// pertenencia actual llegan ya resueltos —un `Map` y un `Set`—, porque quien llama los pide **una sola vez** por
// petición o por aviso: resolverlos aquí sería una consulta por comentario.

/**
 * Comentario tal y como lo ve el grupo. `authorLeft` se deriva de la pertenencia actual; el nombre de quien ya no está
 * en el grupo se sigue mostrando (decisión humana 4).
 */
export function toCommentView(
  comment: GroupLinkComment,
  names: ReadonlyMap<string, string>,
  memberIds: ReadonlySet<string>,
): GroupLinkCommentView {
  return {
    id: comment.id,
    author: toLinkSharer(comment.authorId, names.get(comment.authorId)),
    authorLeft: authorLeftGiven(comment, memberIds),
    text: comment.text,
    createdAt: comment.createdAt.toISOString(),
  };
}

/** Resumen de la tarjeta: contadores de la relación y los dos últimos comentarios, del más reciente al más antiguo. */
export function toCommentsSummary(
  counters: CommentsCounters,
  latest: readonly GroupLinkComment[],
  names: ReadonlyMap<string, string>,
  memberIds: ReadonlySet<string>,
): CommentsSummary {
  return {
    count: counters.count,
    revision: counters.revision,
    sharedAt: counters.sharedAt.toISOString(),
    latest: latest.map((comment) => toCommentView(comment, names, memberIds)),
  };
}

/** Página del hilo, con `total` desde el contador de la relación y el cursor ya codificado. */
export function toCommentPage(
  page: CommentPageSlice,
  total: number,
  names: ReadonlyMap<string, string>,
  memberIds: ReadonlySet<string>,
): CommentPage {
  return {
    items: page.items.map((comment) =>
      toCommentView(comment, names, memberIds),
    ),
    total,
    ...(page.nextCursor === undefined
      ? {}
      : { nextCursor: encodeCursor(page.nextCursor) }),
  };
}

/** Nota de quien compartió, tal y como la ve el grupo. */
export function toShareNoteView(note: ShareNote): ShareNoteView {
  return { text: note.text, createdAt: note.createdAt.toISOString() };
}

/** Autores de esos comentarios, sin repetir, para pedir sus nombres de una vez. */
export function authorIdsOf(comments: readonly GroupLinkComment[]): string[] {
  return [...new Set(comments.map((comment) => comment.authorId))];
}
