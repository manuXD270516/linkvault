import { z } from 'zod';

// Evento de integración del borrado (ADR-009, D8 de cv-upload-extract): `DELETE /api/cv/:id` borra el documento y
// escribe este evento en la misma transacción; el worker borra el objeto del almacén desde la cola `delete-cv-file`.
//
// Va por outbox y no dentro de la petición HTTP porque eso sería el **dual-write** que ADR-009 prohíbe, y el más caro
// de fallar: si el almacén no responde o el proceso muere tras el `commit`, el binario del dato más personal del
// producto sobreviviría sin nada que lo recuerde. Borrar un objeto que ya no está es un acierto en S3, así que el
// consumidor es idempotente por naturaleza.

/** Cola de BullMQ donde se publica. */
export const DELETE_CV_FILE_QUEUE = 'delete-cv-file';

/** Tipo versionado del evento, tal y como se guarda en `outbox_events.type`. */
export const CV_DELETED_EVENT_TYPE = 'CvDeleted.v1';

/** Qué archivo hay que borrar, por sus identificadores: la clave la compone `cvFileKey`. */
export const cvDeletedPayloadSchema = z.strictObject({
  cvId: z.string().min(1),
  userId: z.string().min(1),
});
export type CvDeletedPayload = z.infer<typeof cvDeletedPayloadSchema>;

/** Evento completo, con su tipo versionado. */
export const cvDeletedEventSchema = z.strictObject({
  type: z.literal(CV_DELETED_EVENT_TYPE),
  payload: cvDeletedPayloadSchema,
});
export type CvDeletedEvent = z.infer<typeof cvDeletedEventSchema>;

/** Evento listo para el outbox a partir de un CV recién borrado. */
export function cvDeletedEvent(payload: CvDeletedPayload): CvDeletedEvent {
  return { type: CV_DELETED_EVENT_TYPE, payload };
}

/**
 * `jobId` determinista: dos borrados del mismo CV son un solo trabajo mientras la cola lo recuerde.
 *
 * **Tres segmentos**, como el de la extracción y por la misma razón: BullMQ rechaza un `jobId` con dos puntos que no
 * tenga exactamente tres partes, y ese rechazo solo se ve contra Redis.
 */
export function cvDeletedJobId(payload: CvDeletedPayload): string {
  return `cv:${payload.cvId}:delete`;
}
