import { z } from 'zod';

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
  endpoint: z.string().url(),
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
