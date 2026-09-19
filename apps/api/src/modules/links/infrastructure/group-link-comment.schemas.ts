import { Schema, Types } from 'mongoose';
import { isCommentId } from '../domain/identifier';

// Colección `group_link_comments` (D2 de group-comments, ADR-026 §2). Un comentario cuelga de una relación
// `group_links` y vive con ella: lo borran la retirada del link (`removeWithComments`) y el borrado del grupo
// (`deleteByGroup`), siempre dentro de la transacción que abre `MongoGroupLinkRepository`, el único dueño de los
// contadores de la relación.
//
// Un solo índice `{ groupId, linkId, createdAt: -1, _id: -1 }` sirve a todo: el hilo paginado por `(createdAt, _id)`
// descendentes, el resumen de la tarjeta (`$topN` por link), el borrado por relación y el borrado por grupo, porque su
// prefijo es `groupId`.
//
// `bufferCommands: false`: sin conexión, una operación falla enseguida en lugar de quedar en cola. `strict`: un campo
// que no está en el schema no se guarda.

export const GROUP_LINK_COMMENT_MODEL_NAME = 'GroupLinkComment';
export const GROUP_LINK_COMMENTS_COLLECTION = 'group_link_comments';

export interface GroupLinkCommentDocument {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  linkId: Types.ObjectId;
  authorId: Types.ObjectId;
  /** Normalizado y de 1 a 500 code points. Nunca se registra. */
  text: string;
  createdAt: Date;
}

export const groupLinkCommentSchema = new Schema<GroupLinkCommentDocument>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    linkId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  {
    bufferCommands: false,
    versionKey: false,
    strict: true,
    collection: GROUP_LINK_COMMENTS_COLLECTION,
  },
);

groupLinkCommentSchema.index({ groupId: 1, linkId: 1, createdAt: -1, _id: -1 });

/** `_id` de un comentario, o `null` si no tiene forma de identificador: un `:commentId` así responde el mismo 404. */
export function toCommentObjectId(commentId: string): Types.ObjectId | null {
  return isCommentId(commentId) ? new Types.ObjectId(commentId) : null;
}
