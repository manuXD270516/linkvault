import { z } from 'zod';
import { jobLinkSummarySchema, previewStatusSchema } from '../schemas/link.schema';

// Aviso de que un link terminó su enriquecimiento (D9 de link-enrichment). Cruza procesos por un canal de Redis: el
// worker lo publica al terminar y `api` lo reparte por SSE a las conexiones de quienes pueden ver ese link. Va
// versionado en el propio `type`, como `LinkCreated.v1`, para que un cambio de forma sea un tipo nuevo y no rompa a un
// proceso desplegado.
//
// El aviso es mínimo a propósito: identificador, estado y versión. No lleva la URL del usuario, ni el preview, ni el
// motivo del fallo, porque el canal de Redis no sabe quién puede ver qué; es `api` quien lee el link una vez por aviso,
// resuelve destinatarios y compone lo que sale hacia cada navegador.

/** Canal de Redis donde viaja el aviso. Lo comparten el publicador del worker y el suscriptor de `api`. */
export const LINK_ENRICHED_CHANNEL = 'events:link.enriched';

/** Tipo versionado del evento. */
export const LINK_ENRICHED_EVENT_TYPE = 'LinkEnriched.v1';

/**
 * Datos del aviso. `previewVersion` es la versión que el worker acababa de escribir en el link, y viaja como **dato
 * del aviso, no como filtro**: `api` no descarta ningún aviso por ella. Lo que reparte lo compone leyendo el link de
 * Mongo, que es donde está la verdad de este instante —si alguien corrigió el preview a mano entre el aviso y el
 * reparto, la pantalla tiene que ver la corrección, no lo que el worker dejó—. Por ser una versión ya escrita empieza
 * en 1 y nunca es 0 ni negativa. `previewStatus` es el estado con el que quedó el link; el publicador solo avisa de
 * estados terminados (`enriched`, `partial`, `failed`), nunca de `pending`.
 */
export const linkEnrichedPayloadSchema = z.strictObject({
  linkId: z.string().min(1),
  previewStatus: previewStatusSchema,
  previewVersion: z.number().int().positive(),
});
export type LinkEnrichedPayload = z.infer<typeof linkEnrichedPayloadSchema>;

/** Evento completo, con su tipo versionado. */
export const linkEnrichedEventSchema = z.strictObject({
  type: z.literal(LINK_ENRICHED_EVENT_TYPE),
  payload: linkEnrichedPayloadSchema,
});
export type LinkEnrichedEvent = z.infer<typeof linkEnrichedEventSchema>;

/** Aviso listo para publicar a partir del link que acaba de escribirse. */
export function linkEnrichedEvent(
  payload: LinkEnrichedPayload,
): LinkEnrichedEvent {
  return { type: LINK_ENRICHED_EVENT_TYPE, payload };
}

// ---------------------------------------------------------------------------------------------------------------
// Lo anterior es el aviso **interno** worker→api, que viaja por Redis y es mínimo a propósito. Lo que sigue es el
// mensaje **api→navegador** del canal SSE (D9): son dos contratos distintos y llevan el link a distinto detalle,
// porque solo `api` sabe quién puede ver qué.

/** Nombre del evento SSE (línea `event:`). Lo comparten el que reparte en `api` y el que escucha en el SPA. */
export const LINK_ENRICHED_EVENT_NAME = 'link.enriched';

/**
 * Cuerpo del evento SSE (línea `data:`): el link **ya actualizado**, con su estado, su versión, su preview y el origen
 * de cada campo, para que la tarjeta se pinte sin pedir nada más. Va envuelto en un objeto en vez de ser el resumen a
 * pelo: así el mensaje puede crecer más adelante sin romper al que lo parsea.
 *
 * El latido del canal NO es un mensaje: es un comentario SSE (una línea que empieza por `:`), así que quien escucha lo
 * descarta con una sola comprobación y ningún parser lo confunde con esto.
 */
export const linkEnrichedMessageSchema = z.strictObject({
  link: jobLinkSummarySchema,
});
export type LinkEnrichedMessage = z.infer<typeof linkEnrichedMessageSchema>;

/** Mensaje listo para el canal a partir del link que api acaba de componer para ese destinatario. */
export function linkEnrichedMessage(
  link: LinkEnrichedMessage['link'],
): LinkEnrichedMessage {
  return { link };
}
