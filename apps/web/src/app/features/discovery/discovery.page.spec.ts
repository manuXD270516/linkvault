import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  DiscoveryHit,
  DiscoverySearchResponse,
  JobLinkSummary,
  SaveLinkResponse,
} from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { DISCOVERY_PAGE_SIZE } from '../../core/discovery/discovery.api';
import { Shell } from '../../layout/shell/shell';
import { DiscoveryPage } from './discovery.page';

const hit: DiscoveryHit = {
  board: 'getonboard',
  title: 'Backend Nest',
  company: 'Acme',
  location: 'Remoto LATAM',
  url: 'https://www.getonbrd.com/jobs/programming/backend-nest-acme',
  salaryText: 'USD 3k–5k',
};

const link: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: hit.url,
  displayUrl: hit.url,
  platform: 'getonboard',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedAt: '2026-09-17T10:00:00.000Z',
};

function searchResponse(
  overrides: Partial<DiscoverySearchResponse> = {},
): DiscoverySearchResponse {
  return {
    results: [hit],
    page: 1,
    pageSize: DISCOVERY_PAGE_SIZE,
    ...overrides,
  };
}

describe('DiscoveryPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/descubrir', Shell);
    expect(harness.fixture.debugElement.query(By.directive(DiscoveryPage))).not.toBeNull();
  });

  afterEach(() => verifyNoPendingRequests(http));

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function queryInput(): HTMLInputElement {
    const input = host().querySelector<HTMLInputElement>('[data-testid="discovery-query"]');
    expect(input).not.toBeNull();
    return input!;
  }

  async function submitSearch(q: string): Promise<void> {
    const input = queryInput();
    input.value = q;
    input.dispatchEvent(new Event('input'));
    await settle();
    host().querySelector<HTMLButtonElement>('[data-testid="discovery-submit"]')!.click();
    await settle();
  }

  async function selectBoard(optionText: string): Promise<void> {
    host().querySelector<HTMLElement>('[data-testid="discovery-board"]')!.click();
    await settle();
    const option = Array.from(document.body.querySelectorAll('mat-option')).find((el) =>
      el.textContent?.includes(optionText),
    );
    expect(option).toBeTruthy();
    (option as HTMLElement).click();
    await settle();
  }

  it('shows coverage copy and does not request on enter', async () => {
    expect(host().querySelector('[data-testid="discovery-page"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="discovery-coverage"]')?.textContent).toContain(
      'LinkedIn',
    );
    expect(host().textContent).toContain('Descubrir');
  });

  it('searches with board filter and shows degraded + results', async () => {
    await selectBoard('GetOnBoard');
    await submitSearch('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/discovery/search',
    );
    expect(request.request.params.get('q')).toBe('Nest');
    expect(request.request.params.get('board')).toBe('getonboard');
    request.flush(
      searchResponse({
        degraded: [{ board: 'remoteok', reason: 'timeout' }],
      }),
    );
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="discovery-degraded-remoteok"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="discovery-hit-getonboard"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="discovery-hit-link"]')?.textContent).toContain(
      'Backend Nest',
    );
    expect(host().querySelector('[data-testid="discovery-hit-company"]')?.textContent).toContain(
      'Acme',
    );
  });

  it('shows honest empty when discovery is disabled (503)', async () => {
    await submitSearch('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/discovery/search',
    );
    const error = apiError('discovery_disabled', 503);
    request.flush(error.body, error.options);
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="discovery-disabled"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="discovery-empty"]')).toBeNull();
    expect(host().querySelector('[data-testid="discovery-results"]')).toBeNull();
  });

  it('shows empty results when API returns none', async () => {
    await submitSearch('xyz');

    http
      .expectOne((req) => req.method === 'GET' && req.url === '/api/discovery/search')
      .flush(searchResponse({ results: [] }));
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="discovery-empty"]')).not.toBeNull();
  });

  it('saves privately and shows created feedback', async () => {
    await submitSearch('Nest');
    http
      .expectOne((req) => req.method === 'GET' && req.url === '/api/discovery/search')
      .flush(searchResponse());
    await settle();
    await harness.fixture.whenStable();

    host().querySelector<HTMLButtonElement>('[data-testid="discovery-save"]')!.click();
    await settle();

    const save = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(save.request.body).toEqual({ url: hit.url });
    save.flush({
      link,
      created: true,
      shared: 'created',
      alreadyInGroups: [],
    } satisfies SaveLinkResponse);
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="discovery-save-created"]')).not.toBeNull();
  });

  it('shows already feedback when link existed', async () => {
    await submitSearch('Nest');
    http
      .expectOne((req) => req.method === 'GET' && req.url === '/api/discovery/search')
      .flush(searchResponse());
    await settle();
    await harness.fixture.whenStable();

    host().querySelector<HTMLButtonElement>('[data-testid="discovery-save"]')!.click();
    await settle();

    http.expectOne({ method: 'POST', url: '/api/links' }).flush({
      link,
      created: false,
      shared: 'already_there',
      alreadyInGroups: [],
    } satisfies SaveLinkResponse);
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="discovery-save-already"]')).not.toBeNull();
  });

  it('shows error feedback when save fails', async () => {
    await submitSearch('Nest');
    http
      .expectOne((req) => req.method === 'GET' && req.url === '/api/discovery/search')
      .flush(searchResponse());
    await settle();
    await harness.fixture.whenStable();

    host().querySelector<HTMLButtonElement>('[data-testid="discovery-save"]')!.click();
    await settle();

    const save = http.expectOne({ method: 'POST', url: '/api/links' });
    const error = apiError('validation_error', 400);
    save.flush(error.body, error.options);
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="discovery-save-error"]')).not.toBeNull();
  });
});
