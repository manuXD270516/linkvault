import { z } from 'zod';

// Evento de integración que cruza procesos (ADR-009, D8 de cv-upload-extract): `api` lo escribe en `outbox_events`
// dentro de la transacción del alta y el relay lo publica en la cola `extract-cv`, donde lo consume el worker.
//
// El payload lleva **solo identificadores**, como `LinkCreated.v1`: ni el nombre del archivo, ni su tipo, ni su
// tamaño. La clave del objeto la compone el worker con la misma `cvFileKey` que la usó al guardarlo, para que no haya
// dos formas de nombrar el mismo archivo.

/** Cola de BullMQ donde se publica. La comparten el relay de `api` y el consumidor del worker. */
export const EXTRACT_CV_QUEUE = 'extract-cv';

/** Tipo versionado del evento, tal y como se guarda en `outbox_events.type`. */
export const CV_UPLOADED_EVENT_TYPE = 'CvUploaded.v1';

/** Qué CV hay que leer y de quién es. Nada más. */
export const cvUploadedPayloadSchema = z.strictObject({
  cvId: z.string().min(1),
  userId: z.string().min(1),
});
export type CvUploadedPayload = z.infer<typeof cvUploadedPayloadSchema>;

/** Evento completo, con su tipo versionado. */
export const cvUploadedEventSchema = z.strictObject({
  type: z.literal(CV_UPLOADED_EVENT_TYPE),
  payload: cvUploadedPayloadSchema,
});
export type CvUploadedEvent = z.infer<typeof cvUploadedEventSchema>;

/** Evento listo para el outbox a partir de un CV recién guardado. */
export function cvUploadedEvent(payload: CvUploadedPayload): CvUploadedEvent {
  return { type: CV_UPLOADED_EVENT_TYPE, payload };
}

/**
 * `jobId` determinista: republicar el mismo evento deja un solo job mientras la cola lo recuerda. La idempotencia de
 * verdad no es esta sino la del consumidor, que escribe condicionado al estado `pending` (D8).
 *
 * **Tres segmentos, y no es cosmética**: BullMQ rechaza con `Custom Id cannot contain :` cualquier `jobId` que lleve
 * dos puntos y no tenga exactamente tres partes. Un `extract-cv:<cvId>` se veía perfecto en los unitarios —que usan
 * una cola doble— y fallaba siempre contra Redis, dejando el CV en `pending` para siempre. Lo comprueba un test de
 * contrato sobre la tabla de enrutado, que recorre todos los tipos.
 */
export function cvUploadedJobId(payload: CvUploadedPayload): string {
  return `cv:${payload.cvId}:extract`;
}
