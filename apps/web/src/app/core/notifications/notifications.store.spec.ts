import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { NotificationsStore } from './notifications.store';

describe('NotificationsStore', () => {
  let store: NotificationsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...providePageTesting(), NotificationsStore],
    });
    store = TestBed.inject(NotificationsStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('loads preferences', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications/preferences').flush({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      notifyOwnActions: false,
    });
    await loading;

    expect(store.loaded()).toBe(true);
    expect(store.preferences().notifyOwnActions).toBe(false);
  });

  it('saves a patch and keeps the response', async () => {
    const saving = store.save({ groupNewLink: false });
    http.expectOne({ method: 'PATCH', url: '/api/notifications/preferences' }).flush({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      groupNewLink: false,
    });
    await expect(saving).resolves.toBe(true);

    expect(store.preferences().groupNewLink).toBe(false);
  });

  it('records a save failure without throwing', async () => {
    const saving = store.save({ applicationStale: false });
    const { body, options } = apiError('validation_error', 400);
    http.expectOne('/api/notifications/preferences').flush(body, options);
    await expect(saving).resolves.toBe(false);
    await settle();

    expect(store.saveFailure()?.kind).toBe('api');
  });
});
