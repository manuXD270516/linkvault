import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SearchResponse } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { SEARCH_PAGE_SIZE, SearchApi } from './search.api';

const emptyResponse: SearchResponse = {
  hits: [],
  limit: SEARCH_PAGE_SIZE,
  offset: 0,
};

describe('SearchApi', () => {
  let api: SearchApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(SearchApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('GETs /api/search with q and default limit, without mode', async () => {
    const result = api.search({ q: 'remoto Nest' });

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request.request.params.get('q')).toBe('remoto Nest');
    expect(request.request.params.get('limit')).toBe(String(SEARCH_PAGE_SIZE));
    expect(request.request.params.has('mode')).toBe(false);
    expect(request.request.params.has('docType')).toBe(false);
    expect(request.request.params.has('groupId')).toBe(false);
    request.flush(emptyResponse);

    await expect(result).resolves.toEqual(emptyResponse);
  });

  it('includes only docType and groupId filters when set', async () => {
    const result = api.search({
      q: 'Nest',
      docType: 'application',
      groupId: 'g1',
      limit: 10,
      offset: 5,
    });

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('docType')).toBe('application');
    expect(request.request.params.get('groupId')).toBe('g1');
    expect(request.request.params.get('limit')).toBe('10');
    expect(request.request.params.get('offset')).toBe('5');
    expect(request.request.params.has('mode')).toBe(false);
    request.flush(emptyResponse);

    await expect(result).resolves.toEqual(emptyResponse);
  });
});
