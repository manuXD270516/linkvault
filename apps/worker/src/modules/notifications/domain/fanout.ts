import type { NotificationPreferences, NotificationType } from '@linkvault/shared';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@linkvault/shared';

export type NotifyChannel = 'email' | 'push';

export interface RecipientCandidate {
  readonly userId: string;
}

export interface DeliveryTarget {
  readonly userId: string;
  readonly channel: NotifyChannel;
}

/** Preferencias efectivas (documento o defaults). */
export function prefsOf(
  stored: NotificationPreferences | null,
): NotificationPreferences {
  return stored ?? { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

export function typeEnabled(
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

/**
 * Filtra destinatarios por opt-out y notifyOwnActions.
 * El canal email se decide aparte con emailVerified.
 */
export function filterRecipients(params: {
  readonly members: readonly string[];
  readonly actorUserId: string;
  readonly prefsOf: (userId: string) => NotificationPreferences;
  readonly type: NotificationType;
}): string[] {
  const result: string[] = [];
  for (const userId of params.members) {
    const prefs = params.prefsOf(userId);
    if (!typeEnabled(prefs, params.type)) {
      continue;
    }
    if (
      userId === params.actorUserId &&
      prefs.notifyOwnActions === false
    ) {
      continue;
    }
    result.push(userId);
  }
  return result;
}

/** Dedupe preservando orden. */
export function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
