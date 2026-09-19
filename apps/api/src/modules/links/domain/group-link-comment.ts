import {
  COMMENT_TEXT_MAX_LENGTH,
  commentTextLength,
  normalizeCommentText,
} from '@linkvault/shared';
import { InvalidCommentText } from './errors';

// Comentario plano de un link en un grupo (ADR-015, D2 y D4 de group-comments): texto, autor y fecha, sin hilos ni
// reacciones ni edición. Vive con la relación link-grupo: existe solo mientras el link siga compartido en ese grupo.
//
// El texto se normaliza, pero no se reescribe (D5): los emails, teléfonos y lo que parezca HTML se quedan tal cual. El
// dominio vuelve a validar lo que el contrato HTTP ya validó, porque un caso de uso puede llamarse sin pasar por él.

/** Rol en el grupo de quien pide, tal y como lo da la pertenencia. */
export type CommentRequesterRole = 'owner' | 'member';

/** Comentario aún no guardado: el repositorio le asigna el id. */
export interface NewGroupLinkComment {
  readonly groupId: string;
  readonly linkId: string;
  readonly authorId: string;
  /** Normalizado y de 1 a 500 code points. */
  readonly text: string;
  readonly createdAt: Date;
}

export interface GroupLinkComment extends NewGroupLinkComment {
  readonly id: string;
}

/** Comentario listo para guardar, con su texto normalizado; `InvalidCommentText` si queda vacío o es demasiado largo. */
export function createGroupLinkComment(input: {
  readonly groupId: string;
  readonly linkId: string;
  readonly authorId: string;
  readonly text: string;
  readonly now: Date;
}): NewGroupLinkComment {
  const text = normalizeCommentText(input.text);
  const length = commentTextLength(text);
  if (length === 0 || length > COMMENT_TEXT_MAX_LENGTH) {
    throw new InvalidCommentText();
  }
  return {
    groupId: input.groupId,
    linkId: input.linkId,
    authorId: input.authorId,
    text,
    createdAt: input.now,
  };
}

/**
 * `true` si quien pide puede borrar el comentario: su autor o el `owner` del grupo (decisión humana 5, ADR-026 §4).
 * Quien pide ya es miembro actual: la pertenencia se comprueba antes.
 */
export function mayDeleteComment(
  comment: Pick<GroupLinkComment, 'authorId'>,
  requesterId: string,
  role: CommentRequesterRole,
): boolean {
  return comment.authorId === requesterId || role === 'owner';
}

/**
 * `true` si el autor ya no es miembro del grupo. Se deriva en cada lectura de la pertenencia actual: salir, ser
 * expulsado o volver no escriben nada (D8).
 */
export function authorLeftGiven(
  comment: Pick<GroupLinkComment, 'authorId'>,
  memberIds: ReadonlySet<string>,
): boolean {
  return !memberIds.has(comment.authorId);
}
