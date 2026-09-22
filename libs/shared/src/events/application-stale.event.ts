import { z } from 'zod';
import { applicationStatusSchema } from '../schemas/application.schema';

// Evento de integración de una postulación estancada (ADR-024 §10; productor en change `notifications`, ADR-035).
// El worker lo detecta con claim + cola (sin outbox). Solo lo necesario para dirigir un aviso al dueño.

/** Tipo versionado del evento. */
export const APPLICATION_STALE_EVENT_TYPE = 'ApplicationStale.v1';

/** Días sin cambio de estado ni de etapa a partir de los cuales una postulación activa se considera estancada. */
export const APPLICATION_STALE_AFTER_DAYS = 10;

/**
 * Datos del evento. `lastChangedAt` es el `statusChangedAt` de la postulación, no su `updatedAt`: editar una nota o el
 * interruptor de compartir no reinicia la cuenta de días (ADR-024 §4).
 */
export const applicationStalePayloadSchema = z.strictObject({
  applicationId: z.string().min(1),
  userId: z.string().min(1),
  linkId: z.string().min(1),
  status: applicationStatusSchema,
  lastChangedAt: z.iso.datetime(),
  staleAfterDays: z.number().int().positive(),
});
export type ApplicationStalePayload = z.infer<
  typeof applicationStalePayloadSchema
>;

/** Evento completo, con su tipo versionado. */
export const applicationStaleEventSchema = z.strictObject({
  type: z.literal(APPLICATION_STALE_EVENT_TYPE),
  payload: applicationStalePayloadSchema,
});
export type ApplicationStaleEvent = z.infer<typeof applicationStaleEventSchema>;

/** Evento listo para publicar a partir de sus datos. */
export function applicationStaleEvent(
  payload: ApplicationStalePayload,
): ApplicationStaleEvent {
  return { type: APPLICATION_STALE_EVENT_TYPE, payload };
}

/**
 * jobId determinista para `Queue.add` desde el detector (sin outbox).
 * Incluye `lastChangedAt` para no colisionar tras un nuevo cambio de estado.
 */
export function applicationStaleJobId(
  payload: ApplicationStalePayload,
): string {
  return `notify:stale:${payload.applicationId}_${payload.lastChangedAt}`;
}
