import { z } from 'zod';

// Evento de integración que cruza procesos: `api` lo escribe en `outbox_events` dentro de la transacción del alta y su
// relay lo publica en BullMQ (ADR-009); el consumidor llega con `link-enrichment`. El contrato va versionado en el
// propio `type`, para que un cambio de forma sea un tipo nuevo y no rompa a un consumidor desplegado (C13 de design
// v0.2). El payload lleva solo identificadores: nunca la URL del usuario ni el texto que la trajo.

/** Cola de BullMQ donde se publica el evento. La comparten el relay de `api` y el consumidor futuro del worker. */
export const ENRICH_LINK_QUEUE = 'enrich-link';

/** Tipo versionado del evento, tal y como se guarda en `outbox_events.type`. */
export const LINK_CREATED_EVENT_TYPE = 'LinkCreated.v1';

/** Datos del evento: qué link hay que enriquecer y en qué versión de preview se pidió. */
export const linkCreatedPayloadSchema = z.strictObject({
  linkId: z.string().min(1),
  previewVersion: z.number().int().positive(),
});
export type LinkCreatedPayload = z.infer<typeof linkCreatedPayloadSchema>;

/** Evento completo, con su tipo versionado. */
export const linkCreatedEventSchema = z.strictObject({
  type: z.literal(LINK_CREATED_EVENT_TYPE),
  payload: linkCreatedPayloadSchema,
});
export type LinkCreatedEvent = z.infer<typeof linkCreatedEventSchema>;

/** Evento listo para el outbox a partir de un link recién creado. */
export function linkCreatedEvent(payload: LinkCreatedPayload): LinkCreatedEvent {
  return { type: LINK_CREATED_EVENT_TYPE, payload };
}

/**
 * `jobId` determinista del evento: publicar dos veces el mismo `LinkCreated` deja un solo job mientras la cola lo
 * recuerda (D6). La versión del preview entra en la clave para que un reenriquecimiento futuro sea un job distinto.
 */
export function linkCreatedJobId(payload: LinkCreatedPayload): string {
  return `enrich:${payload.linkId}:${payload.previewVersion}`;
}
