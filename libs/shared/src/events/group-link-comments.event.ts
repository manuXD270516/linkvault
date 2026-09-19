import { z } from 'zod';
import { commentsSummarySchema } from '../schemas/group-link-comment.schema';

// Aviso de que cambiaron los comentarios de un link en un grupo (D9 de group-comments, ADR-026 §9). Viaja en dos tramos
// con contenidos distintos:
//
// - **Redis** (`GroupLinkCommentsChanged.v1`): `api` lo publica al confirmar un alta o un borrado y lo recibe cada
//   instancia de `api`. Es un aviso mínimo, solo identificadores y el tipo de cambio: el canal no sabe quién puede ver
//   qué, sus mensajes se ven con `MONITOR` y cualquier suscriptor los recibe todos. Nunca lleva el texto ni el autor.
// - **SSE** (`group-link.comments`): cada instancia lo reparte a los miembros actuales de ese grupo con el resumen ya
//   actualizado, texto incluido, porque ellos ya pueden leerlo con un `GET`.
//
// Va versionado en el propio `type`, como `LinkEnriched.v1`, para que un cambio de forma sea un tipo nuevo.

/** Canal de Redis donde viaja el aviso. Lo comparten el publicador y el suscriptor de `api`. */
export const GROUP_LINK_COMMENTS_CHANNEL = 'events:group-link.comments';

/** Tipo versionado del evento. */
export const GROUP_LINK_COMMENTS_CHANGED_EVENT_TYPE =
  'GroupLinkCommentsChanged.v1';

/** Qué le pasó al comentario. */
export const commentChangeSchema = z.enum(['created', 'deleted']);
export type CommentChange = z.infer<typeof commentChangeSchema>;

/** Datos del aviso interno: solo identificadores y el tipo de cambio. Estricto: rechaza `text`, `authorId` o cualquier otro. */
export const groupLinkCommentsChangedPayloadSchema = z.strictObject({
  groupId: z.string().min(1),
  linkId: z.string().min(1),
  commentId: z.string().min(1),
  change: commentChangeSchema,
});
export type GroupLinkCommentsChangedPayload = z.infer<
  typeof groupLinkCommentsChangedPayloadSchema
>;

/** Evento completo, con su tipo versionado. */
export const groupLinkCommentsChangedEventSchema = z.strictObject({
  type: z.literal(GROUP_LINK_COMMENTS_CHANGED_EVENT_TYPE),
  payload: groupLinkCommentsChangedPayloadSchema,
});
export type GroupLinkCommentsChangedEvent = z.infer<
  typeof groupLinkCommentsChangedEventSchema
>;

/** Aviso listo para publicar a partir de la escritura que acaba de confirmarse. */
export function groupLinkCommentsChangedEvent(
  payload: GroupLinkCommentsChangedPayload,
): GroupLinkCommentsChangedEvent {
  return { type: GROUP_LINK_COMMENTS_CHANGED_EVENT_TYPE, payload };
}

// ---------------------------------------------------------------------------------------------------------------
// Lo anterior es el aviso **interno** entre instancias de `api`. Lo que sigue es el mensaje **api→navegador** del canal
// SSE: solo lo reciben los miembros actuales de ese grupo.

/** Nombre del evento SSE (línea `event:`). Lo comparten el que reparte en `api` y el que escucha en el SPA. */
export const GROUP_LINK_COMMENTS_EVENT_NAME = 'group-link.comments';

/**
 * Cuerpo del evento SSE (línea `data:`): el grupo, el link, el tipo de cambio, el comentario afectado y el resumen ya
 * actualizado —`count`, `revision`, `sharedAt` y los dos últimos con su texto, su autor y `authorLeft`—, para que la
 * tarjeta se pinte sin otra petición.
 */
export const groupLinkCommentsMessageSchema = z.strictObject({
  groupId: z.string().min(1),
  linkId: z.string().min(1),
  change: commentChangeSchema,
  commentId: z.string().min(1),
  comments: commentsSummarySchema,
});
export type GroupLinkCommentsMessage = z.infer<
  typeof groupLinkCommentsMessageSchema
>;

/** Mensaje listo para el canal a partir del aviso y del resumen que `api` acaba de componer. */
export function groupLinkCommentsMessage(
  notice: GroupLinkCommentsChangedPayload,
  comments: GroupLinkCommentsMessage['comments'],
): GroupLinkCommentsMessage {
  return {
    groupId: notice.groupId,
    linkId: notice.linkId,
    change: notice.change,
    commentId: notice.commentId,
    comments,
  };
}
