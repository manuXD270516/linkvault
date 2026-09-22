import { z } from 'zod';

// Fan-out de notificación al crear una relación nueva link↔grupo (change notifications, ADR-035).
// `api` lo escribe en outbox en la misma txn; el worker expande destinatarios. Solo identificadores.

/** Cola BullMQ del fan-out de notificaciones de producto. */
export const NOTIFY_FANOUT_QUEUE = 'notify-fanout';

/** Tipo versionado del evento. */
export const GROUP_LINK_ADDED_EVENT_TYPE = 'GroupLinkAdded.v1';

export const groupLinkAddedPayloadSchema = z.strictObject({
  groupId: z.string().min(1),
  linkId: z.string().min(1),
  actorUserId: z.string().min(1),
});
export type GroupLinkAddedPayload = z.infer<typeof groupLinkAddedPayloadSchema>;

export const groupLinkAddedEventSchema = z.strictObject({
  type: z.literal(GROUP_LINK_ADDED_EVENT_TYPE),
  payload: groupLinkAddedPayloadSchema,
});
export type GroupLinkAddedEvent = z.infer<typeof groupLinkAddedEventSchema>;

export function groupLinkAddedEvent(
  payload: GroupLinkAddedPayload,
): GroupLinkAddedEvent {
  return { type: GROUP_LINK_ADDED_EVENT_TYPE, payload };
}

/**
 * jobId determinista mientras el job vive en la cola.
 * BullMQ exige exactamente 3 segmentos si hay `:` (`Custom Id cannot contain :`).
 */
export function groupLinkAddedJobId(payload: GroupLinkAddedPayload): string {
  return `notify:gla:${payload.groupId}_${payload.linkId}_${payload.actorUserId}`;
}
