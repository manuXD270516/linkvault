import { z } from 'zod';
import { applicationStatusSchema } from '../schemas/application.schema';

// Fan-out al cambiar el estado canónico de una postulación con visibility=group (ADR-035).
// Sin stageLabel/notas. `groupId` opcional acota el fan-out (validado en api).
// `statusChangedAt` (D6) distingue reaperturas applied→X→applied.

/** Tipo versionado del evento. */
export const APPLICATION_STATUS_NOTIFY_EVENT_TYPE = 'ApplicationStatusNotify.v1';

export const applicationStatusNotifyPayloadSchema = z.strictObject({
  applicationId: z.string().min(1),
  linkId: z.string().min(1),
  actorUserId: z.string().min(1),
  status: applicationStatusSchema,
  /** ISO datetime del cambio; clave de idempotencia (D6). */
  statusChangedAt: z.iso.datetime(),
  groupId: z.string().min(1).optional(),
});
export type ApplicationStatusNotifyPayload = z.infer<
  typeof applicationStatusNotifyPayloadSchema
>;

export const applicationStatusNotifyEventSchema = z.strictObject({
  type: z.literal(APPLICATION_STATUS_NOTIFY_EVENT_TYPE),
  payload: applicationStatusNotifyPayloadSchema,
});
export type ApplicationStatusNotifyEvent = z.infer<
  typeof applicationStatusNotifyEventSchema
>;

export function applicationStatusNotifyEvent(
  payload: ApplicationStatusNotifyPayload,
): ApplicationStatusNotifyEvent {
  return { type: APPLICATION_STATUS_NOTIFY_EVENT_TYPE, payload };
}

/**
 * jobId determinista (3 segmentos con `:` — regla BullMQ).
 * Tercer segmento: `applicationId_status_scope_statusChangedAt` (ISO sin `:`).
 */
export function applicationStatusNotifyJobId(
  payload: ApplicationStatusNotifyPayload,
): string {
  const scope = payload.groupId ?? 'union';
  const at = payload.statusChangedAt.replaceAll(':', '');
  return `notify:asn:${payload.applicationId}_${payload.status}_${scope}_${at}`;
}
