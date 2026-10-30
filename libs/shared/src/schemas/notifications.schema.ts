import { z } from 'zod';
import { isKnownPushEndpoint } from '../notifications/push-services';

// Preferencias de notificación de producto (change notifications, ADR-035;
// digest: group-weekly-digest).

export const notificationTypeSchema = z.enum([
  'group_new_link',
  'application_status_group',
  'application_stale',
  'group_weekly_digest',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationPreferencesSchema = z.strictObject({
  groupNewLink: z.boolean(),
  applicationStatusGroup: z.boolean(),
  applicationStale: z.boolean(),
  groupWeeklyDigest: z.boolean(),
  notifyOwnActions: z.boolean(),
  applicationStatusGroupId: z.string().min(1).nullable(),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  groupNewLink: true,
  applicationStatusGroup: true,
  applicationStale: true,
  groupWeeklyDigest: true,
  notifyOwnActions: true,
  applicationStatusGroupId: null,
};

export const patchNotificationPreferencesSchema = z
  .strictObject({
    groupNewLink: z.boolean().optional(),
    applicationStatusGroup: z.boolean().optional(),
    applicationStale: z.boolean().optional(),
    groupWeeklyDigest: z.boolean().optional(),
    notifyOwnActions: z.boolean().optional(),
    applicationStatusGroupId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (body) =>
      body.groupNewLink !== undefined ||
      body.applicationStatusGroup !== undefined ||
      body.applicationStale !== undefined ||
      body.groupWeeklyDigest !== undefined ||
      body.notifyOwnActions !== undefined ||
      body.applicationStatusGroupId !== undefined,
    { message: 'at least one preference field is required' },
  );
export type PatchNotificationPreferencesRequest = z.infer<
  typeof patchNotificationPreferencesSchema
>;

export const pushSubscriptionRequestSchema = z.strictObject({
  // Solo servicios push conocidos, con un criterio de URL que los dos analizadores no puedan leer de forma distinta
  // (D7 de enrichment-egress-guard): un endpoint de otro host es un `400 validation_error` que nombra `endpoint`.
  // `refine` sobre la cadena cruda, antes de cualquier normalización de zod (que recortaría un espacio inicial): el
  // predicado exige que el texto ya sea canónico y de un servicio conocido, así que tampoco hace falta `.url()`.
  endpoint: z
    .string()
    .refine(isKnownPushEndpoint, { message: 'unknown_push_service' }),
  keys: z.strictObject({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionRequest = z.infer<
  typeof pushSubscriptionRequestSchema
>;

export const vapidPublicKeyResponseSchema = z.strictObject({
  publicKey: z.string().min(1),
});
export type VapidPublicKeyResponse = z.infer<
  typeof vapidPublicKeyResponseSchema
>;
