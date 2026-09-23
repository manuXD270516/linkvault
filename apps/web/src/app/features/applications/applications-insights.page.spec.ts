import { HttpTestingController } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { APPLICATION_STATUSES } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import type { ApplicationAnalyticsResponse } from '../../core/applications/application-analytics';
import { emptyApplicationAnalytics } from '../../core/applications/application-analytics';
import { SessionStore } from '../../core/auth/session.store';
import { ApplicationsInsightsPage } from './applications-insights.page';

const ANALYTICS_URL = '/api/applications/analytics';

function analyticsWith(
  overrides: Partial<ApplicationAnalyticsResponse> = {},
): ApplicationAnalyticsResponse {
  const empty = emptyApplicationAnalytics();
  return {
    ...empty,
    ...overrides,
    byStatus: { ...empty.byStatus, ...overrides.byStatus },
    stale: overrides.stale ?? empty.stale,
  };
}

describe('ApplicationsInsightsPage', () => {
  let fixture: ComponentFixture<ApplicationsInsightsPage>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function open(body: ApplicationAnalyticsResponse): Promise<void> {
    fixture = TestBed.createComponent(ApplicationsInsightsPage);
    http.expectOne(ANALYTICS_URL).flush(body);
    await settle();
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(element: Element | null = host()): string {
    return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('shows empty state when there are no applications', async () => {
    await open(emptyApplicationAnalytics());

    expect(host().querySelector('[data-testid="insights-empty"]')).not.toBeNull();
    expect(text()).toContain('Aún no tienes postulaciones');
    expect(host().querySelector('[data-testid="insights-summary"]')).toBeNull();
  });

  it('shows open/closed/accepted, byStatus and stale with board links', async () => {
    await open(
      analyticsWith({
        byStatus: {
          saved: 0,
          interested: 1,
          applied: 2,
          in_process: 0,
          offer: 0,
          accepted: 1,
          rejected: 1,
          withdrawn: 0,
          expired: 0,
        },
        openCount: 3,
        closedCount: 1,
        acceptedCount: 1,
        stale: [
          {
            applicationId: 'a-stale',
            linkId: 'l-stale',
            status: 'applied',
            statusChangedAt: '2026-09-01T10:00:00.000Z',
          },
        ],
      }),
    );

    expect(host().querySelector('[data-testid="insights-empty"]')).toBeNull();
    expect(text(host().querySelector('[data-testid="insights-open"]'))).toContain('3');
    expect(text(host().querySelector('[data-testid="insights-closed"]'))).toContain('1');
    expect(text(host().querySelector('[data-testid="insights-accepted"]'))).toContain('1');

    for (const status of APPLICATION_STATUSES) {
      expect(host().querySelector(`[data-status="${status}"]`)).not.toBeNull();
    }

    const staleLink = host().querySelector<HTMLAnchorElement>(
      '[data-testid="insights-stale-a-stale"]',
    );
    expect(staleLink).not.toBeNull();
    expect(staleLink?.getAttribute('href')).toContain('/postulaciones');
    expect(staleLink?.getAttribute('href')).toContain('applicationId=a-stale');
    expect(staleLink?.getAttribute('href')).toContain('linkId=l-stale');
    expect(text(staleLink)).toContain('Postulada');
    expect(text(staleLink)).toContain('Ver en el tablero');
  });

  it('shows a honest none message when stale is empty but there are applications', async () => {
    await open(
      analyticsWith({
        byStatus: { ...emptyApplicationAnalytics().byStatus, applied: 1 },
        openCount: 1,
        stale: [],
      }),
    );

    expect(host().querySelector('[data-testid="insights-stale-none"]')).not.toBeNull();
    expect(text()).toContain('Ninguna postulación abierta');
  });

  it('links back to the board from the header', async () => {
    await open(emptyApplicationAnalytics());

    expect(host().querySelector('a[href="/postulaciones"]')).not.toBeNull();
    expect(host().querySelector('a[href="/grupos"]')).not.toBeNull();
    expect(host().querySelector('a[href="/mis-links"]')).not.toBeNull();
  });
});
