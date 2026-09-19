import { z } from 'zod';
import { applicationStatusSchema } from '../schemas/application.schema';

// Evento de integración de una postulación estancada (D9 de applications-tracking, ADR-024 §10). Solo está modelado:
// en este change no tiene productor, ni canal, ni consumidor, y nadie recibe por él ningún aviso. El change de F2 que
// lo produzca decidirá si viaja por el outbox o por un cron del worker. Va versionado en el propio `type`, como
// `LinkCreated.v1`.
//
// No lleva etapa, notas ni historial: solo lo necesario para decidir y dirigir un aviso a su dueño.

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
