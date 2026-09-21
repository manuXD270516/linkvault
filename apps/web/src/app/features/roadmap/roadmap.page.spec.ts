import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import type { RoadmapItem, RoadmapResponse } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { RoadmapStore } from '../../core/roadmap/roadmap.store';
import { Shell } from '../../layout/shell/shell';
import { groupItemsByWeeks } from './roadmap-labels';
import { RoadmapPage } from './roadmap.page';

const ANALYSIS_ID = 'a1';
const ROADMAP_URL = `/api/analyses/${ANALYSIS_ID}/roadmap`;
const MD_URL = `/api/analyses/${ANALYSIS_ID}/roadmap.md`;

const items: RoadmapItem[] = [
  {
    skill: 'Kubernetes',
    priority: 1,
    estimatedWeeks: 2,
    resources: [
      {
        type: 'course',
        title: 'K8s verified',
        url: 'https://example.com/k8s',
        provider: 'Catalog',
        free: true,
        verified: true,
      },
      {
        type: 'video',
        title: 'Guessed video',
        url: null,
        provider: 'YouTube',
        free: true,
        verified: false,
      },
    ],
  },
  {
    skill: 'GraphQL',
    priority: 2,
    estimatedWeeks: 1,
    resources: [
      {
        type: 'doc',
        title: 'Official docs',
        url: 'https://graphql.org',
        provider: 'Official',
        free: true,
        verified: true,
      },
    ],
  },
];

const ready: RoadmapResponse = {
  roadmapId: 'r1',
  analysisId: ANALYSIS_ID,
  status: 'ready',
  items,
};

describe('groupItemsByWeeks', () => {
  it('groups and sorts by estimated weeks', () => {
    expect(groupItemsByWeeks(items).map((group) => group.weeks)).toEqual([1, 2]);
    expect(groupItemsByWeeks(items)[0]?.items.map((item) => item.skill)).toEqual(['GraphQL']);
  });
});

describe('RoadmapPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    stopPolling();
    verifyNoPendingRequests(http);
  });

  function stopPolling(): void {
    harness.fixture.debugElement
      .query(By.directive(RoadmapPage))
      ?.injector.get(RoadmapStore)
      .stopPolling();
  }

  function page(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  async function open(body: RoadmapResponse = ready): Promise<void> {
    await harness.navigateByUrl(`/plan/${ANALYSIS_ID}`, Shell);
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'GET', url: ROADMAP_URL }),
    );
    request.flush(body);
    await settle();
    harness.detectChanges();
  }

  it('shows generating without inventing a ready plan', async () => {
    await open({
      roadmapId: 'r1',
      analysisId: ANALYSIS_ID,
      status: 'generating',
    });

    expect(page().querySelector('[data-testid="roadmap-generating"]')).not.toBeNull();
    expect(page().querySelector('[data-testid="roadmap-weeks"]')).toBeNull();
    expect(text()).not.toContain('Kubernetes');
  });

  it('shows weeks, priority and verified distinction when ready', async () => {
    await open();

    expect(page().querySelector('[data-testid="roadmap-weeks"]')).not.toBeNull();
    expect(text()).toContain('1 semana');
    expect(text()).toContain('2 semanas');
    expect(text()).toContain('Kubernetes');
    expect(text()).toContain('Prioridad 1');
    expect(page().querySelector('[data-testid="roadmap-resource-verified"]')).not.toBeNull();
    expect(page().querySelector('[data-testid="roadmap-resource-unverified"]')).not.toBeNull();
    expect(
      page().querySelector('[data-testid="roadmap-resource"][data-verified="true"]'),
    ).not.toBeNull();
    expect(
      page().querySelector('[data-testid="roadmap-resource"][data-verified="false"]'),
    ).not.toBeNull();
  });

  it('shows an honest failed message', async () => {
    await open({
      roadmapId: 'r1',
      analysisId: ANALYSIS_ID,
      status: 'failed',
    });

    expect(page().querySelector('[data-testid="roadmap-failed"]')).not.toBeNull();
    expect(page().querySelector('[data-testid="roadmap-weeks"]')).toBeNull();
  });

  it('exports markdown from the API', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:md');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await open();
    page().querySelector<HTMLButtonElement>('[data-testid="roadmap-export"]')?.click();
    await settle();

    http.expectOne({ method: 'GET', url: MD_URL }).flush('# Study roadmap\n');
    await settle();
    expect(click).toHaveBeenCalled();

    click.mockRestore();
  });
});
