import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import type { GroupSummary, SearchHit, SearchResponse } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { SEARCH_PAGE_SIZE } from '../../core/search/search.api';
import { Shell } from '../../layout/shell/shell';
import { SearchPage } from './search.page';

const groups: GroupSummary[] = [
  {
    id: 'g1',
    name: 'Backend Bolivia',
    role: 'member',
    memberCount: 2,
    joinedAt: '2026-09-17T10:00:00.000Z',
  },
];

const previewHit: SearchHit = {
  id: 'job_preview:l1',
  docType: 'job_preview',
  title: 'Nest remoto',
  snippet: 'Backend NestJS',
  score: 0.9,
  linkId: 'l1',
  groupId: 'g1',
};

describe('SearchPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/buscar', Shell);
    expect(harness.fixture.debugElement.query(By.directive(SearchPage))).not.toBeNull();
    await flushGroups();
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function flushGroups(list: GroupSummary[] = groups): Promise<void> {
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'GET', url: '/api/groups' }),
    );
    request.flush(list);
    await settle();
    await harness.fixture.whenStable();
  }

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function queryInput(): HTMLInputElement {
    const input = host().querySelector<HTMLInputElement>('[data-testid="search-query"]');
    expect(input).not.toBeNull();
    return input!;
  }

  async function submitSearch(q: string): Promise<void> {
    const input = queryInput();
    input.value = q;
    input.dispatchEvent(new Event('input'));
    await settle();
    host().querySelector<HTMLButtonElement>('[data-testid="search-submit"]')!.click();
    await settle();
  }

  it('shows the query field and does not request search on enter', async () => {
    expect(host().querySelector('[data-testid="search-query"]')).not.toBeNull();
    expect(host().textContent).toContain('Buscar');
    // Sin envío: no hay GET /api/search pendiente.
  });

  it('does not call the API for an empty query', async () => {
    await submitSearch('   ');
    expect(host().querySelector('[data-testid="search-empty-query"]')).not.toBeNull();
    http.verify();
  });

  it('searches with docType filter and without mode', async () => {
    // Mat-select: open and pick application.
    host().querySelector<HTMLElement>('[data-testid="search-doc-type"]')!.click();
    await settle();
    const option = Array.from(document.body.querySelectorAll('mat-option')).find((el) =>
      el.textContent?.includes('Postulación'),
    );
    expect(option).toBeTruthy();
    (option as HTMLElement).click();
    await settle();

    await submitSearch('Nest');
    const request = await vi.waitFor(() =>
      http.expectOne((req) => req.method === 'GET' && req.url === '/api/search'),
    );
    expect(request.request.params.get('q')).toBe('Nest');
    expect(request.request.params.get('docType')).toBe('application');
    expect(request.request.params.has('mode')).toBe(false);
    request.flush({
      hits: [],
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
    } satisfies SearchResponse);
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="search-empty"]')).not.toBeNull();
  });

  it('renders typed hits, degraded notice, and navigation', async () => {
    await submitSearch('remoto');
    const request = await vi.waitFor(() =>
      http.expectOne((req) => req.method === 'GET' && req.url === '/api/search'),
    );
    request.flush({
      hits: [previewHit],
      degraded: true,
      degradeReason: 'embeddings_unavailable',
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
      estimatedTotal: 1,
    } satisfies SearchResponse);
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="search-degraded"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="search-hit-job_preview"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="search-hit-type"]')?.textContent).toContain(
      'Vacante',
    );
    const link = host().querySelector<HTMLAnchorElement>('[data-testid="search-hit-link"]');
    expect(link?.getAttribute('href')).toBe('/grupos/g1');
    expect(link?.textContent).toContain('Nest remoto');
  });

  it('shows an honest unavailable message on 503', async () => {
    await submitSearch('Nest');
    const request = await vi.waitFor(() =>
      http.expectOne((req) => req.method === 'GET' && req.url === '/api/search'),
    );
    const error = apiError('search_unavailable', 503);
    request.flush(error.body, error.options);
    await settle();
    await harness.fixture.whenStable();

    expect(host().querySelector('[data-testid="search-unavailable"]')).not.toBeNull();
  });

  it('does not expose mode, modality or status controls', () => {
    expect(host().querySelector('[data-testid="search-mode"]')).toBeNull();
    expect(host().textContent).not.toMatch(/hybrid|fulltext|semantic|modalidad|Modalidad/i);
    // "Estado" as application-status filter must not appear as a control label.
    expect(host().querySelector('[data-testid="search-status"]')).toBeNull();
    expect(host().querySelector('[data-testid="search-modality"]')).toBeNull();
  });
});
