import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  apiError,
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { PushBrowser } from './push-browser';
import { PushNotifications } from './push-notifications';

/** Suscripción mínima tipada para mockear PushManager. */
function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/e1'): PushSubscription {
  return {
    endpoint,
    expirationTime: null,
    options: { userVisibleOnly: true, applicationServerKey: null },
    getKey: () => null,
    toJSON: () => ({
      endpoint,
      keys: { p256dh: 'p256', auth: 'auth' },
    }),
    unsubscribe: async () => true,
  } as unknown as PushSubscription;
}

describe('PushNotifications', () => {
  let push: PushNotifications;
  let http: HttpTestingController;
  let browser: {
    supported: ReturnType<typeof vi.fn>;
    permission: ReturnType<typeof vi.fn>;
    requestPermission: ReturnType<typeof vi.fn>;
    registerServiceWorker: ReturnType<typeof vi.fn>;
    readyRegistration: ReturnType<typeof vi.fn>;
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    browser = {
      supported: vi.fn(() => true),
      permission: vi.fn(() => 'default' as NotificationPermission),
      requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
      registerServiceWorker: vi.fn(async () => ({})),
      readyRegistration: vi.fn(async () => ({})),
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => fakeSubscription()),
    };

    TestBed.configureTestingModule({
      providers: [
        ...providePageTesting(),
        { provide: PushBrowser, useValue: browser },
      ],
    });
    push = TestBed.inject(PushNotifications);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => {
    verifyNoPendingRequests(http);
    TestBed.resetTestingModule();
  });

  it('returns denied without calling the API when permission is refused', async () => {
    browser.requestPermission.mockResolvedValue('denied');

    await expect(push.enable()).resolves.toEqual({ kind: 'denied' });
    http.expectNone('/api/notifications/push-vapid-public-key');
    expect(push.subscribed()).toBe(false);
  });

  it('registers a subscription after VAPID and permission', async () => {
    const enabling = push.enable();

    const vapid = await vi.waitFor(() =>
      http.expectOne('/api/notifications/push-vapid-public-key'),
    );
    vapid.flush({ publicKey: 'BAAA' });

    const register = await vi.waitFor(() =>
      http.expectOne({ method: 'POST', url: '/api/notifications/push-subscriptions' }),
    );
    expect(register.request.body).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/e1',
      keys: { p256dh: 'p256', auth: 'auth' },
    });
    register.flush(null, { status: 201, statusText: 'Created' });

    await expect(enabling).resolves.toEqual({ kind: 'enabled' });
    expect(push.subscribed()).toBe(true);
  });

  it('maps missing VAPID (503) without blocking preferences', async () => {
    const enabling = push.enable();
    const { body, options } = apiError('service_unavailable', 503);
    const vapid = await vi.waitFor(() =>
      http.expectOne('/api/notifications/push-vapid-public-key'),
    );
    vapid.flush(body, options);

    await expect(enabling).resolves.toEqual({ kind: 'vapid_unavailable' });
  });

  it('returns unsupported when the browser has no push', async () => {
    browser.supported.mockReturnValue(false);

    await expect(push.enable()).resolves.toEqual({ kind: 'unsupported' });
  });

  it('disables by deleting the endpoint and unsubscribing', async () => {
    const subscription = fakeSubscription();
    browser.getSubscription.mockResolvedValue(subscription);
    const unsub = vi.spyOn(subscription, 'unsubscribe');

    const disabling = push.disable();
    const remove = await vi.waitFor(() =>
      http.expectOne(
        (req) =>
          req.method === 'DELETE' &&
          req.urlWithParams.includes('/api/notifications/push-subscriptions'),
      ),
    );
    expect(remove.request.params.get('endpoint')).toBe('https://fcm.googleapis.com/fcm/send/e1');
    remove.flush(null, { status: 204, statusText: 'No Content' });

    await expect(disabling).resolves.toEqual({ kind: 'disabled' });
    expect(unsub).toHaveBeenCalled();
    expect(push.subscribed()).toBe(false);
  });

  /** Completa el alta con la respuesta dada: lleva `enable()` hasta el `POST` de la suscripción. */
  async function enableWithRegistration(
    respond: (request: ReturnType<HttpTestingController['expectOne']>) => void,
  ) {
    const enabling = push.enable();
    const vapid = await vi.waitFor(() =>
      http.expectOne('/api/notifications/push-vapid-public-key'),
    );
    vapid.flush({ publicKey: 'BAAA' });
    const register = await vi.waitFor(() =>
      http.expectOne({ method: 'POST', url: '/api/notifications/push-subscriptions' }),
    );
    respond(register);
    return enabling;
  }

  function rejectEndpoint(request: ReturnType<HttpTestingController['expectOne']>): void {
    const { body, options } = apiError('validation_error', 400);
    request.flush(body, options);
  }

  it('unsubscribes the browser subscription and answers unsupported when the API rejects the endpoint', async () => {
    const subscription = fakeSubscription();
    const unsubscribe = vi.spyOn(subscription, 'unsubscribe');
    browser.subscribe.mockResolvedValue(subscription);

    const outcome = await enableWithRegistration(rejectEndpoint);

    expect(outcome.kind).toBe('unsupported');
    expect(push.subscribed()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes an existing browser subscription when the API rejects the endpoint', async () => {
    const existing = fakeSubscription();
    const unsubscribe = vi.spyOn(existing, 'unsubscribe');
    browser.getSubscription.mockResolvedValue(existing);

    const outcome = await enableWithRegistration(rejectEndpoint);

    expect(outcome.kind).toBe('unsupported');
    expect(push.subscribed()).toBe(false);
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('still answers unsupported when unsubscribe rejects', async () => {
    const subscription = fakeSubscription();
    const unsubscribe = vi
      .spyOn(subscription, 'unsubscribe')
      .mockRejectedValue(new Error('unsubscribe failed'));
    browser.subscribe.mockResolvedValue(subscription);

    const outcome = await enableWithRegistration(rejectEndpoint);

    expect(outcome.kind).toBe('unsupported');
    expect(push.subscribed()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the browser subscription on a transient registration failure', async () => {
    const subscription = fakeSubscription();
    const unsubscribe = vi.spyOn(subscription, 'unsubscribe');
    browser.subscribe.mockResolvedValue(subscription);

    const outcome = await enableWithRegistration((request) => {
      const { body, options } = apiError('internal_error', 500);
      request.flush(body, options);
    });

    expect(outcome.kind).toBe('failed');
    expect(push.subscribed()).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
