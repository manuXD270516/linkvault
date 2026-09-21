import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RoadmapResponse } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { ROADMAP_POLL_INTERVAL_MS, RoadmapStore } from './roadmap.store';

const READY_URL = '/api/analyses/a1/roadmap';
const MD_URL = '/api/analyses/a1/roadmap.md';

const ready: RoadmapResponse = {
  roadmapId: 'r1',
  analysisId: 'a1',
  status: 'ready',
  items: [
    {
      skill: 'GraphQL',
      priority: 2,
      estimatedWeeks: 1,
      resources: [
        {
          type: 'doc',
          title: 'GraphQL docs',
          url: 'https://graphql.org',
          provider: 'Official',
          free: true,
          verified: true,
        },
      ],
    },
    {
      skill: 'Kubernetes',
      priority: 1,
      estimatedWeeks: 2,
      resources: [
        {
          type: 'course',
          title: 'Guessed course',
          url: null,
          provider: 'LLM',
          free: false,
          verified: false,
        },
      ],
    },
  ],
};

describe('RoadmapStore', () => {
  let store: RoadmapStore;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [...providePageTesting(), RoadmapStore],
    });
    store = TestBed.inject(RoadmapStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => {
    store.stopPolling();
    verifyNoPendingRequests(http);
    vi.useRealTimers();
  });

  async function flushGet(body: RoadmapResponse): Promise<void> {
    http.expectOne({ method: 'GET', url: READY_URL }).flush(body);
    await vi.advanceTimersByTimeAsync(0);
  }

  async function loadReady(body: RoadmapResponse = ready): Promise<void> {
    const pending = store.load('a1');
    await flushGet(body);
    await pending;
  }

  it('loads a ready roadmap without polling', async () => {
    await loadReady();

    expect(store.status()).toBe('ready');
    expect(store.sortedItems().map((item) => item.skill)).toEqual(['Kubernetes', 'GraphQL']);
    expect(store.isReady()).toBe(true);
  });

  it('polls while generating then stops on ready', async () => {
    const pending = store.load('a1');
    await flushGet({
      roadmapId: 'r1',
      analysisId: 'a1',
      status: 'generating',
    });
    await pending;
    expect(store.isGenerating()).toBe(true);

    await vi.advanceTimersByTimeAsync(ROADMAP_POLL_INTERVAL_MS);
    await flushGet(ready);

    expect(store.isReady()).toBe(true);
    expect(store.items()).toHaveLength(2);
  });

  it('POSTs when GET returns analysis_not_found', async () => {
    const pending = store.load('a1');
    const missing = apiError('analysis_not_found', 404);
    http.expectOne({ method: 'GET', url: READY_URL }).flush(missing.body, missing.options);
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne({ method: 'POST', url: READY_URL }).flush(
      { roadmapId: 'r1', status: 'generating' },
      { status: 202, statusText: 'Accepted' },
    );
    await vi.advanceTimersByTimeAsync(0);
    await pending;

    expect(store.status()).toBe('generating');
    store.stopPolling();
  });

  it('exports markdown from the API', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:md');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await loadReady();

    const exportPending = store.exportMarkdown();
    http.expectOne({ method: 'GET', url: MD_URL }).flush('# Study roadmap\n');
    await vi.advanceTimersByTimeAsync(0);
    await exportPending;

    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:md');

    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('surfaces failed status without inventing items', async () => {
    await loadReady({
      roadmapId: 'r1',
      analysisId: 'a1',
      status: 'failed',
    });

    expect(store.isFailed()).toBe(true);
    expect(store.items()).toEqual([]);
  });
});
