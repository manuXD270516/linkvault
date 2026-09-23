import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type NotificationType,
  type PatchNotificationPreferencesRequest,
} from '@linkvault/shared';

/** Preferencias persistidas de un usuario (o ausencia = defaults). */
export interface StoredNotificationPreferences extends NotificationPreferences {
  readonly userId: string;
  readonly updatedAt: Date;
}

/** Preferencias efectivas: documento o defaults ON. */
export function effectivePreferences(
  stored: NotificationPreferences | null,
): NotificationPreferences {
  return stored ?? { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

/** Fusiona un PATCH sobre las preferencias efectivas actuales. */
export function applyPreferencePatch(
  current: NotificationPreferences,
  patch: PatchNotificationPreferencesRequest,
): NotificationPreferences {
  return {
    groupNewLink: patch.groupNewLink ?? current.groupNewLink,
    applicationStatusGroup:
      patch.applicationStatusGroup ?? current.applicationStatusGroup,
    applicationStale: patch.applicationStale ?? current.applicationStale,
    groupWeeklyDigest: patch.groupWeeklyDigest ?? current.groupWeeklyDigest,
    notifyOwnActions: patch.notifyOwnActions ?? current.notifyOwnActions,
    applicationStatusGroupId:
      patch.applicationStatusGroupId !== undefined
        ? patch.applicationStatusGroupId
        : current.applicationStatusGroupId,
  };
}

/** ¿El tipo está habilitado en las preferencias efectivas? */
export function isTypeEnabled(
  prefs: NotificationPreferences,
  type: NotificationType,
): boolean {
  switch (type) {
    case 'group_new_link':
      return prefs.groupNewLink;
    case 'application_status_group':
      return prefs.applicationStatusGroup;
    case 'application_stale':
      return prefs.applicationStale;
    case 'group_weekly_digest':
      return prefs.groupWeeklyDigest;
  }
}
