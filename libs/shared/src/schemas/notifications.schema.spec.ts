import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesSchema,
  notificationTypeSchema,
  patchNotificationPreferencesSchema,
  pushSubscriptionRequestSchema,
} from './notifications.schema';

describe('notification preferences', () => {
  it('defaults son todo ON y sin alcance', () => {
    expect(
      notificationPreferencesSchema.parse(DEFAULT_NOTIFICATION_PREFERENCES),
    ).toEqual({
      groupNewLink: true,
      applicationStatusGroup: true,
      applicationStale: true,
      groupWeeklyDigest: true,
      notifyOwnActions: true,
      applicationStatusGroupId: null,
    });
  });

  it('incluye group_weekly_digest en los tipos', () => {
    expect(notificationTypeSchema.safeParse('group_weekly_digest').success).toBe(
      true,
    );
  });

  it('PATCH exige al menos un campo', () => {
    expect(patchNotificationPreferencesSchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      patchNotificationPreferencesSchema.safeParse({ groupNewLink: false })
        .success,
    ).toBe(true);
    expect(
      patchNotificationPreferencesSchema.safeParse({
        groupWeeklyDigest: false,
      }).success,
    ).toBe(true);
  });

  it('push subscription exige endpoint y keys', () => {
    expect(
      pushSubscriptionRequestSchema.safeParse({
        endpoint: 'https://push.example/x',
        keys: { p256dh: 'a', auth: 'b' },
      }).success,
    ).toBe(true);
    expect(
      pushSubscriptionRequestSchema.safeParse({ endpoint: 'not-a-url' })
        .success,
    ).toBe(false);
  });
});
