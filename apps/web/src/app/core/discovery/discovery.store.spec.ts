import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { DISCOVERY_PAGE_SIZE } from './discovery.api';
import { DiscoveryStore } from './discovery.store';

const hit: DiscoveryHit = {
  board: 'getonboard',
  title: 'Backend Nest',
  company: 'Acme',
  url: 'https://www.getonbrd.com/jobs/programming/backend-nest-acme',
};

const emptyResponse: DiscoverySearchResponse = {
  results: [],
  page: 1,
  pageSize: DISCOVERY_PAGE_SIZE,
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

function saved(overrides: Partial<SaveLinkResponse> = {}): SaveLinkResponse {
  return {
    link,
    created: true,
    shared: 'created',
    alreadyInGroups: [],
    ...overrides,
  };
}

describe('DiscoveryStore', () => {
  let store: DiscoveryStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...providePageTesting(), DiscoveryStore],
    });
    store = TestBed.inject(DiscoveryStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('run sends q and board and stores results + degraded', async () => {
    store.setBoard('getonboard');
    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/discovery/search',
    );
    expect(request.request.params.get('q')).toBe('Nest');
    expect(request.request.params.get('board')).toBe('getonboard');
    expect(request.request.params.get('pageSize')).toBe(String(DISCOVERY_PAGE_SIZE));
    request.flush({
      results: [hit],
      degraded: [{ board: 'remoteok', reason: 'timeout' }],
      page: 1,
      pageSize: DISCOVERY_PAGE_SIZE,
    } satisfies DiscoverySearchResponse);
    await pending;

    expect(store.results()).toEqual([hit]);
    expect(store.degraded()).toEqual([{ board: 'remoteok', reason: 'timeout' }]);
    expect(store.searched()).toBe(true);
    expect(store.isEmpty()).toBe(false);
  });

  it('run allows empty q', async () => {
    const pending = store.run('   ');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/discovery/search',
    );
    expect(request.request.params.get('q')).toBe('');
    request.flush(emptyResponse);
    await pending;

    expect(store.query()).toBe('');
    expect(store.isEmpty()).toBe(true);
  });

  it('run records failure and clears results on error', async () => {
    const pending = store.run('Nest');
    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/discovery/search',
    );
    const error = apiError('discovery_disabled', 503);
    request.flush(error.body, error.options);
    await pending;

    expect(store.failure()).toMatchObject({
      kind: 'api',
      status: 503,
      code: 'discovery_disabled',
    });
    expect(store.results()).toEqual([]);
    expect(store.searched()).toBe(true);
  });

  it('save posts private link and sets created feedback', async () => {
    const pending = store.save(hit);

    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(request.request.body).toEqual({ url: hit.url });
    request.flush(saved());
    await pending;

    expect(store.saveOutcomes()[hit.url]).toBe('created');
    expect(store.savingUrls()[hit.url]).toBeUndefined();
  });

  it('save sets already feedback when shared is already_there', async () => {
    const pending = store.save(hit);

    http
      .expectOne({ method: 'POST', url: '/api/links' })
      .flush(saved({ created: false, shared: 'already_there' }));
    await pending;

    expect(store.saveOutcomes()[hit.url]).toBe('already');
  });

  it('save sets error feedback when POST fails', async () => {
    const pending = store.save(hit);

    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    const error = apiError('validation_error', 400);
    request.flush(error.body, error.options);
    await pending;

    expect(store.saveOutcomes()[hit.url]).toBe('error');
  });
});
