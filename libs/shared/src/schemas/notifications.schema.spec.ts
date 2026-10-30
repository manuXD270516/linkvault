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
    expect(
      notificationTypeSchema.safeParse('group_weekly_digest').success,
    ).toBe(true);
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
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: 'a', auth: 'b' },
      }).success,
    ).toBe(true);
    expect(
      pushSubscriptionRequestSchema.safeParse({ endpoint: 'not-a-url' })
        .success,
    ).toBe(false);
  });
});

describe('push endpoint allow-list', () => {
  const keys = { p256dh: 'a', auth: 'b' };
  const accepts = (endpoint: string): boolean =>
    pushSubscriptionRequestSchema.safeParse({ endpoint, keys }).success;

  it('accepts an endpoint of each known push service', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGxyz',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://push.apple.com/x',
    ]) {
      expect(accepts(endpoint), endpoint).toBe(true);
    }
  });

  it('rejects an unknown push host', () => {
    for (const endpoint of [
      'https://push.example/x',
      'https://example.com/fcm.googleapis.com',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest',
      'https://googleapis.com/x',
    ]) {
      expect(accepts(endpoint), endpoint).toBe(false);
    }
    const result = pushSubscriptionRequestSchema.safeParse({
      endpoint: 'https://push.example/x',
      keys,
    });
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual([
      'endpoint',
    ]);
  });

  it('rejects http and non-443 ports on a known host', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://fcm.googleapis.com:80/fcm/send/abc',
    ]) {
      expect(accepts(endpoint), endpoint).toBe(false);
    }
  });

  it('rejects a host that ends with a known suffix without a label boundary', () => {
    for (const endpoint of [
      'https://evilfcm.googleapis.com/x',
      'https://xpush.apple.com/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://notify.windows.com.evil.example/x',
      'https://fcm.googleapis.com./x',
    ]) {
      expect(accepts(endpoint), endpoint).toBe(false);
    }
  });

  it('rejects an endpoint that is not already in canonical WHATWG form or carries forbidden characters', () => {
    const base = 'https://fcm.googleapis.com/fcm/send/abc';
    const cases: Record<string, string> = {
      space: `${base} x`,
      'leading space': ` ${base}`,
      tab: `https://fcm.googleapis.com/fcm/${String.fromCharCode(9)}send`,
      newline: `${base}${String.fromCharCode(10)}`,
      control: `https://fcm.googleapis.com/fcm/${String.fromCharCode(1)}send`,
      backslash: `https://fcm.googleapis.com${String.fromCharCode(92)}@evil.example/x`,
      'backslash in path': `https://fcm.googleapis.com/fcm${String.fromCharCode(92)}send`,
      'underscore in host': 'https://fcm_x.googleapis.com/x',
      'non-ASCII host': 'https://fcm.googleapis.cóm/x',
      'uppercase host': 'https://FCM.googleapis.com/x',
      'explicit default port': 'https://fcm.googleapis.com:443/x',
      'dot segments': 'https://fcm.googleapis.com/a/../b',
      credentials: 'https://user:pass@fcm.googleapis.com/x',
      'userinfo trick': 'https://fcm.googleapis.com@evil.example/x',
      'missing path': 'https://fcm.googleapis.com',
    };
    for (const [category, endpoint] of Object.entries(cases)) {
      expect(accepts(endpoint), category).toBe(false);
    }
  });
});
