import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { NotificationPreferences } from '@linkvault/shared';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { NotificationsApi } from './notifications.api';

const prefs: NotificationPreferences = {
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  groupNewLink: false,
  applicationStatusGroupId: 'g1',
};

describe('NotificationsApi', () => {
  let api: NotificationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(NotificationsApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  function expectRequest(method: string, url: string) {
    const request = http.expectOne(url);
    expect(request.request.method).toBe(method);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    return request;
  }

  it('gets preferences', async () => {
    const result = api.getPreferences();

    expectRequest('GET', '/api/notifications/preferences').flush(prefs);

    await expect(result).resolves.toEqual(prefs);
  });

  it('patches preferences', async () => {
    const result = api.patchPreferences({ groupNewLink: false });

    const request = expectRequest('PATCH', '/api/notifications/preferences');
    expect(request.request.body).toEqual({ groupNewLink: false });
    request.flush({ ...DEFAULT_NOTIFICATION_PREFERENCES, groupNewLink: false });

    await expect(result).resolves.toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      groupNewLink: false,
    });
  });

  it('gets the VAPID public key', async () => {
    const result = api.getVapidPublicKey();

    expectRequest('GET', '/api/notifications/push-vapid-public-key').flush({
      publicKey: 'BPtest',
    });

    await expect(result).resolves.toEqual({ publicKey: 'BPtest' });
  });

  it('registers a push subscription', async () => {
    const body = {
      endpoint: 'https://push.example/e1',
      keys: { p256dh: 'p', auth: 'a' },
    };
    const result = api.registerPushSubscription(body);

    const request = expectRequest('POST', '/api/notifications/push-subscriptions');
    expect(request.request.body).toEqual(body);
    request.flush(null, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toBeUndefined();
  });

  it('removes a push subscription by endpoint query', async () => {
    const result = api.removePushSubscription('https://push.example/e1');

    const request = http.expectOne(
      (req) =>
        req.method === 'DELETE' &&
        req.urlWithParams.startsWith('/api/notifications/push-subscriptions'),
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request.request.params.get('endpoint')).toBe('https://push.example/e1');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });
});
