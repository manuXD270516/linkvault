import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import { DEFAULT_NOTIFICATION_PREFERENCES, type GroupSummary } from '@linkvault/shared';
import {
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { PushBrowser } from '../../core/notifications/push-browser';
import { Shell } from '../../layout/shell/shell';
import { NotificationsPage } from './notifications.page';

const groups: GroupSummary[] = [
  {
    id: 'g1',
    name: 'Backend Bolivia',
    role: 'member',
    memberCount: 2,
    joinedAt: '2026-09-17T10:00:00.000Z',
  },
];

describe('NotificationsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let browser: {
    supported: ReturnType<typeof vi.fn>;
    permission: ReturnType<typeof vi.fn>;
    requestPermission: ReturnType<typeof vi.fn>;
    registerServiceWorker: ReturnType<typeof vi.fn>;
    readyRegistration: ReturnType<typeof vi.fn>;
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    browser = {
      supported: vi.fn(() => true),
      permission: vi.fn(() => 'default' as NotificationPermission),
      requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
      registerServiceWorker: vi.fn(async () => ({})),
      readyRegistration: vi.fn(async () => ({})),
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ...providePageTesting(),
        { provide: PushBrowser, useValue: browser },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/notificaciones', Shell);
    expect(harness.fixture.debugElement.query(By.directive(NotificationsPage))).not.toBeNull();
    await flushBootstrap();
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function flushBootstrap(
    prefs = DEFAULT_NOTIFICATION_PREFERENCES,
    groupList: GroupSummary[] = groups,
  ): Promise<void> {
    const prefsReq = await vi.waitFor(() =>
      http.expectOne({ method: 'GET', url: '/api/notifications/preferences' }),
    );
    prefsReq.flush(prefs);
    const groupsReq = await vi.waitFor(() =>
      http.expectOne({ method: 'GET', url: '/api/groups' }),
    );
    groupsReq.flush(groupList);
    await settle();
    await harness.fixture.whenStable();
  }

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  it('disables group_new_link and patches the API', async () => {
    const toggle = host().querySelector<HTMLElement>(
      '[data-testid="pref-group-new-link"] button',
    );
    expect(toggle).not.toBeNull();
    toggle!.click();
    await settle();

    buttonWithText(host(), 'Guardar preferencias').click();
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'PATCH', url: '/api/notifications/preferences' }),
    );
    expect(request.request.body).toMatchObject({ groupNewLink: false });
    request.flush({ ...DEFAULT_NOTIFICATION_PREFERENCES, groupNewLink: false });
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="notifications-saved"]')).not.toBeNull();
  });

  it('disables group_weekly_digest and patches the API', async () => {
    const toggle = host().querySelector<HTMLElement>(
      '[data-testid="pref-group-weekly-digest"] button',
    );
    expect(toggle).not.toBeNull();
    toggle!.click();
    await settle();

    buttonWithText(host(), 'Guardar preferencias').click();
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'PATCH', url: '/api/notifications/preferences' }),
    );
    expect(request.request.body).toMatchObject({ groupWeeklyDigest: false });
    request.flush({ ...DEFAULT_NOTIFICATION_PREFERENCES, groupWeeklyDigest: false });
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="notifications-saved"]')).not.toBeNull();
  });

  it('persists an optional applicationStatusGroupId', async () => {
    const select = host().querySelector('[data-testid="pref-status-group"]');
    expect(select).not.toBeNull();
    // Mat-select: open and pick the named group.
    (select as HTMLElement).click();
    await settle();
    const option = Array.from(document.body.querySelectorAll('mat-option')).find((el) =>
      el.textContent?.includes('Backend Bolivia'),
    );
    expect(option).toBeTruthy();
    (option as HTMLElement).click();
    await settle();

    buttonWithText(host(), 'Guardar preferencias').click();
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'PATCH', url: '/api/notifications/preferences' }),
    );
    expect(request.request.body).toMatchObject({ applicationStatusGroupId: 'g1' });
    request.flush({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      applicationStatusGroupId: 'g1',
    });
    await settle();
  });

  it('keeps email prefs editable when push permission is denied', async () => {
    browser.requestPermission.mockResolvedValue('denied');

    host().querySelector<HTMLElement>('[data-testid="push-enable"]')!.click();
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="push-denied"]')).not.toBeNull();
    http.expectNone('/api/notifications/push-vapid-public-key');
    expect(host().querySelector('[data-testid="pref-group-new-link"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="notifications-save"]')).not.toBeNull();
  });
});
