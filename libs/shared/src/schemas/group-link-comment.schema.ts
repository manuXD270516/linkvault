import { z } from 'zod';
import {
  COMMENT_TEXT_MAX_LENGTH,
  normalizeCommentText,
  SHARE_NOTE_MAX_LENGTH,
} from '../text/comment-text';
import { linkSharerSchema } from './link-sharer.schema';

// Contratos HTTP de los comentarios de un link en un grupo y de la nota de quien comparte (D10 de group-comments,
// ADR-026). El texto se normaliza **antes** de medirse (`normalizeCommentText`): "   " es un comentario vacío y 500
// caracteres rodeados de espacios caben. Los identificadores de la URL no pasan por aquí: su formato lo juzga el
// dominio, para que uno mal formado responda el mismo `404` que uno inexistente.

/** Cota de cordura del texto recibido antes de normalizarlo: diez veces el límite de negocio de un comentario. */
export const COMMENT_TEXT_INPUT_MAX_LENGTH = 5000;

/** Cota de cordura de la nota recibida antes de normalizarla: diez veces su límite de negocio. */
export const SHARE_NOTE_INPUT_MAX_LENGTH = 2800;

/** Cota de cordura del cursor opaco del hilo: uno manipulado lo rechaza el caso de uso nombrando `cursor`. */
export const COMMENT_CURSOR_INPUT_MAX_LENGTH = 128;

/** Tamaño de página por defecto y máximo del hilo, los mismos que los listados de links. */
export const COMMENT_PAGE_DEFAULT_LIMIT = 20;
export const COMMENT_PAGE_MAX_LIMIT = 50;

/** Máximo de comentarios que el resumen de la tarjeta lleva en `latest`. */
export const COMMENTS_SUMMARY_LATEST = 2;

/** Texto de un comentario: normalizado y de 1 a 500 code points. */
export const commentTextSchema = z
  .string()
  .max(COMMENT_TEXT_INPUT_MAX_LENGTH)
  .transform(normalizeCommentText)
  .pipe(z.string().min(1).max(COMMENT_TEXT_MAX_LENGTH));

/**
 * Texto de una nota: normalizado y de como mucho 280 code points. Puede quedar vacío: quien lo usa decide que una nota
 * vacía equivale a no enviarla (`saveLinkRequestSchema`).
 */
export const shareNoteTextSchema = z
  .string()
  .max(SHARE_NOTE_INPUT_MAX_LENGTH)
  .transform(normalizeCommentText)
  .pipe(z.string().max(SHARE_NOTE_MAX_LENGTH));

/** Cuerpo de `POST /api/groups/:id/links/:linkId/comments`. */
export const createCommentRequestSchema = z.object({
  text: commentTextSchema,
});
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

/** Query de `GET /api/groups/:id/links/:linkId/comments`: `limit` llega como texto; el `cursor` es opaco. */
export const listCommentsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(COMMENT_PAGE_MAX_LIMIT)
    .default(COMMENT_PAGE_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(COMMENT_CURSOR_INPUT_MAX_LENGTH).optional(),
});
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;

/**
 * Comentario tal y como lo ven el hilo, el resumen de la tarjeta y el aviso en vivo. `authorLeft` se deriva en cada
 * lectura de la pertenencia actual: `true` si el autor ya no es miembro del grupo. El texto es plano: el SPA lo pinta
 * escapado, nunca como HTML.
 */
export const groupLinkCommentSchema = z.strictObject({
  id: z.string().min(1),
  author: linkSharerSchema,
  authorLeft: z.boolean(),
  text: z.string().min(1).max(COMMENT_TEXT_MAX_LENGTH),
  createdAt: z.iso.datetime(),
});
export type GroupLinkComment = z.infer<typeof groupLinkCommentSchema>;

/**
 * Resumen de los comentarios de un link en un grupo, el de la tarjeta. `revision` sube con cada alta y cada borrado y
 * nunca retrocede mientras dure la relación; `sharedAt` identifica la relación, porque al quitar el link y volver a
 * compartirlo la revisión empieza de nuevo en 0. El SPA compara la pareja (`sharedAt`, `revision`) para no pintar un
 * resumen viejo encima de uno nuevo. `latest` va del más reciente al más antiguo.
 */
export const commentsSummarySchema = z.strictObject({
  count: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  sharedAt: z.iso.datetime(),
  latest: z.array(groupLinkCommentSchema).max(COMMENTS_SUMMARY_LATEST),
});
export type CommentsSummary = z.infer<typeof commentsSummarySchema>;

/** Respuesta `201` del alta: el comentario y el resumen ya actualizado. */
export const createCommentResponseSchema = z.strictObject({
  comment: groupLinkCommentSchema,
  comments: commentsSummarySchema,
});
export type CreateCommentResponse = z.infer<typeof createCommentResponseSchema>;

/** Respuesta `200` del borrado: el resumen ya actualizado, con la misma forma que en el alta. */
export const deleteCommentResponseSchema = z.strictObject({
  comments: commentsSummarySchema,
});
export type DeleteCommentResponse = z.infer<typeof deleteCommentResponseSchema>;

/**
 * Página del hilo, del más reciente al más antiguo. `total` es el número de comentarios del link en el grupo y no
 * depende del tamaño de página; `nextCursor` solo viaja cuando hay más.
 */
export const commentPageSchema = z.strictObject({
  items: z.array(groupLinkCommentSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).optional(),
});
export type CommentPage = z.infer<typeof commentPageSchema>;

/** Nota de quien compartió el link en el grupo. No se edita, así que su fecha es la de creación. */
export const shareNoteSchema = z.strictObject({
  text: z.string().min(1).max(SHARE_NOTE_MAX_LENGTH),
  createdAt: z.iso.datetime(),
});
export type ShareNote = z.infer<typeof shareNoteSchema>;
