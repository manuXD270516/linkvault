import { z } from 'zod';

// Evento de integración que dispara `build-roadmap` (study-roadmap, ADR-009).
// `api` lo escribe en `outbox_events` desde el POST; el worker también puede encolar el mismo job
// tras un match `done` (opción A: Queue.add con jobId determinista, sin outbox en el worker).
//
// El payload lleva **solo identificadores**: el consumidor vuelve a leer análisis, oferta y consentimiento.

/** Cola de BullMQ donde se publica. La comparten el relay de `api` y el consumidor del worker. */
export const BUILD_ROADMAP_QUEUE = 'build-roadmap';

/** Tipo versionado del evento, tal y como se guarda en `outbox_events.type`. */
export const ROADMAP_REQUESTED_EVENT_TYPE = 'RoadmapRequested.v1';

/** Qué roadmap hay que construir y de quién es el análisis. Nada más. */
export const roadmapRequestedPayloadSchema = z.strictObject({
  analysisId: z.string().min(1),
  userId: z.string().min(1),
});
export type RoadmapRequestedPayload = z.infer<
  typeof roadmapRequestedPayloadSchema
>;

/** Evento completo, con su tipo versionado. */
export const roadmapRequestedEventSchema = z.strictObject({
  type: z.literal(ROADMAP_REQUESTED_EVENT_TYPE),
  payload: roadmapRequestedPayloadSchema,
});
export type RoadmapRequestedEvent = z.infer<typeof roadmapRequestedEventSchema>;

/** Evento listo para el outbox a partir de un claim ganado o un auto-enqueue. */
export function roadmapRequestedEvent(
  payload: RoadmapRequestedPayload,
): RoadmapRequestedEvent {
  return { type: ROADMAP_REQUESTED_EVENT_TYPE, payload };
}

/**
 * `jobId` determinista: republicar el mismo evento (POST + auto) deja un solo job mientras la cola lo recuerda.
 * La idempotencia de verdad es el claim `generating` por `analysisId` (unique).
 *
 * **Tres segmentos, y no es cosmética**: BullMQ rechaza con `Custom Id cannot contain :` cualquier `jobId` que lleve
 * dos puntos y no tenga exactamente tres partes. Un `roadmap:<analysisId>` fallaría contra Redis —el mismo defecto
 * de `cv-upload-extract` / `match`. Lo comprueba un test de contrato sobre la tabla de enrutado.
 */
export function roadmapRequestedJobId(payload: RoadmapRequestedPayload): string {
  return `roadmap:${payload.analysisId}:build`;
}
