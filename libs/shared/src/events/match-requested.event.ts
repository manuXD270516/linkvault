import { z } from 'zod';

// Evento de integración que cruza procesos (ADR-009, D2): `api` lo escribe en `outbox_events` dentro de la
// transacción del alta del análisis y el relay lo publica en la cola `analyze-match`, donde lo consume el worker.
//
// El payload lleva **solo identificadores**: ni el texto del CV, ni el de la oferta, ni el prompt. Quien ejecuta vuelve
// a leer esos datos de sus almacenes.

/** Cola de BullMQ donde se publica. La comparten el relay de `api` y el consumidor del worker. */
export const ANALYZE_MATCH_QUEUE = 'analyze-match';

/** Tipo versionado del evento, tal y como se guarda en `outbox_events.type`. */
export const MATCH_REQUESTED_EVENT_TYPE = 'MatchRequested.v1';

/** Qué análisis hay que ejecutar, de quién es, sobre qué oferta y con qué CV. Nada más. */
export const matchRequestedPayloadSchema = z.strictObject({
  analysisId: z.string().min(1),
  userId: z.string().min(1),
  linkId: z.string().min(1),
  cvId: z.string().min(1),
});
export type MatchRequestedPayload = z.infer<typeof matchRequestedPayloadSchema>;

/** Evento completo, con su tipo versionado. */
export const matchRequestedEventSchema = z.strictObject({
  type: z.literal(MATCH_REQUESTED_EVENT_TYPE),
  payload: matchRequestedPayloadSchema,
});
export type MatchRequestedEvent = z.infer<typeof matchRequestedEventSchema>;

/** Evento listo para el outbox a partir de un análisis pedido. */
export function matchRequestedEvent(
  payload: MatchRequestedPayload,
): MatchRequestedEvent {
  return { type: MATCH_REQUESTED_EVENT_TYPE, payload };
}

/**
 * `jobId` determinista: republicar el mismo evento deja un solo job mientras la cola lo recuerda. La idempotencia de
 * verdad no es esta sino la del consumidor, que escribe condicionado al estado `running` y al plazo (D12-bis).
 *
 * **Tres segmentos, y no es cosmética**: BullMQ rechaza con `Custom Id cannot contain :` cualquier `jobId` que lleve
 * dos puntos y no tenga exactamente tres partes. Un `match:<analysisId>` se vería perfecto en unitarios con cola doble
 * y fallaría siempre contra Redis —el mismo defecto de `cv-upload-extract`. Lo comprueba un test de contrato sobre la
 * tabla de enrutado.
 */
export function matchRequestedJobId(payload: MatchRequestedPayload): string {
  return `match:${payload.analysisId}:analyze`;
}
