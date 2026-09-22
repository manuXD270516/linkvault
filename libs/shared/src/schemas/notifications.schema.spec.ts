import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesSchema,
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
      notifyOwnActions: true,
      applicationStatusGroupId: null,
    });
  });

  it('PATCH exige al menos un campo', () => {
    expect(patchNotificationPreferencesSchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      patchNotificationPreferencesSchema.safeParse({ groupNewLink: false })
        .success,
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
