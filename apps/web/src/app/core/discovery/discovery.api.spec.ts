import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { DiscoverySearchResponse } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { DISCOVERY_PAGE_SIZE, DiscoveryApi } from './discovery.api';

const emptyResponse: DiscoverySearchResponse = {
  results: [],
  page: 1,
  pageSize: DISCOVERY_PAGE_SIZE,
};

describe('DiscoveryApi', () => {
  let api: DiscoveryApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(DiscoveryApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('GETs /api/discovery/search with q, board and default pageSize', async () => {
    const result = api.search({ q: 'Nest remoto', board: 'all' });

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/discovery/search',
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request.request.params.get('q')).toBe('Nest remoto');
    expect(request.request.params.get('board')).toBe('all');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe(String(DISCOVERY_PAGE_SIZE));
    request.flush(emptyResponse);

    await expect(result).resolves.toEqual(emptyResponse);
  });

  it('forwards board, page and pageSize when set', async () => {
    const result = api.search({
      q: '',
      board: 'remoteok',
      page: 2,
      pageSize: 5,
    });

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/discovery/search',
    );
    expect(request.request.params.get('q')).toBe('');
    expect(request.request.params.get('board')).toBe('remoteok');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('5');
    request.flush(emptyResponse);

    await expect(result).resolves.toEqual(emptyResponse);
  });
});
