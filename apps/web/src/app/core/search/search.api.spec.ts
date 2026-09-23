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
    expect(request.request.params.has('modality')).toBe(false);
    expect(request.request.params.has('applicationStatus')).toBe(false);
    expect(request.request.params.has('salaryCurrency')).toBe(false);
    request.flush(emptyResponse);

    await expect(result).resolves.toEqual(emptyResponse);
  });

  it('includes docType, groupId and LatAm filters when set', async () => {
    const result = api.search({
      q: 'Nest',
      docType: 'job_preview',
      groupId: 'g1',
      modality: 'remote',
      salaryCurrency: 'USD',
      limit: 10,
      offset: 5,
    });

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('docType')).toBe('job_preview');
    expect(request.request.params.get('groupId')).toBe('g1');
    expect(request.request.params.get('modality')).toBe('remote');
    expect(request.request.params.get('salaryCurrency')).toBe('USD');
    expect(request.request.params.has('applicationStatus')).toBe(false);
    expect(request.request.params.get('limit')).toBe('10');
    expect(request.request.params.get('offset')).toBe('5');
    expect(request.request.params.has('mode')).toBe(false);
    request.flush(emptyResponse);

    await expect(result).resolves.toEqual(emptyResponse);
  });

  it('includes applicationStatus in HttpParams when set', async () => {
    const result = api.search({
      q: 'Nest',
      docType: 'application',
      applicationStatus: 'applied',
    });

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('docType')).toBe('application');
    expect(request.request.params.get('applicationStatus')).toBe('applied');
    expect(request.request.params.has('modality')).toBe(false);
    expect(request.request.params.has('salaryCurrency')).toBe(false);
    request.flush(emptyResponse);

    await expect(result).resolves.toEqual(emptyResponse);
  });

  it('serializes openOnly as true|false query strings', async () => {
    const pendingTrue = api.search({
      q: 'Nest',
      docType: 'job_preview',
      openOnly: true,
    });
    const reqTrue = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(reqTrue.request.params.get('openOnly')).toBe('true');
    reqTrue.flush(emptyResponse);
    await expect(pendingTrue).resolves.toEqual(emptyResponse);

    const pendingFalse = api.search({ q: 'Nest', openOnly: false });
    const reqFalse = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(reqFalse.request.params.get('openOnly')).toBe('false');
    reqFalse.flush(emptyResponse);
    await expect(pendingFalse).resolves.toEqual(emptyResponse);
  });
});
