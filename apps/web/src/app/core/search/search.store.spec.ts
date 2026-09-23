import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SearchResponse } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { SEARCH_PAGE_SIZE } from './search.api';
import { SearchStore } from './search.store';

const emptyResponse: SearchResponse = {
  hits: [],
  limit: SEARCH_PAGE_SIZE,
  offset: 0,
};

describe('SearchStore', () => {
  let store: SearchStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...providePageTesting(), SearchStore],
    });
    store = TestBed.inject(SearchStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('setModality forces job_preview and clears applicationStatus (D3b)', () => {
    store.setApplicationStatus('applied');
    expect(store.docType()).toBe('application');
    expect(store.applicationStatus()).toBe('applied');

    store.setModality('remote');

    expect(store.modality()).toBe('remote');
    expect(store.docType()).toBe('job_preview');
    expect(store.applicationStatus()).toBeNull();
  });

  it('setSalaryCurrency forces job_preview and clears applicationStatus (D3b)', () => {
    store.setApplicationStatus('applied');
    store.setSalaryCurrency('USD');

    expect(store.salaryCurrency()).toBe('USD');
    expect(store.docType()).toBe('job_preview');
    expect(store.applicationStatus()).toBeNull();
  });

  it('setApplicationStatus forces application and clears modality/currency (D3b)', () => {
    store.setModality('hybrid');
    store.setSalaryCurrency('BOB');
    expect(store.docType()).toBe('job_preview');

    store.setApplicationStatus('applied');

    expect(store.applicationStatus()).toBe('applied');
    expect(store.docType()).toBe('application');
    expect(store.modality()).toBeNull();
    expect(store.salaryCurrency()).toBeNull();
  });

  it('run sends modality and salaryCurrency without applicationStatus', async () => {
    store.setModality('remote');
    store.setSalaryCurrency('USD');
    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('q')).toBe('Nest');
    expect(request.request.params.get('docType')).toBe('job_preview');
    expect(request.request.params.get('modality')).toBe('remote');
    expect(request.request.params.get('salaryCurrency')).toBe('USD');
    expect(request.request.params.has('applicationStatus')).toBe(false);
    request.flush(emptyResponse);
    await pending;
  });

  it('run sends applicationStatus without modality or salaryCurrency', async () => {
    store.setApplicationStatus('applied');
    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('docType')).toBe('application');
    expect(request.request.params.get('applicationStatus')).toBe('applied');
    expect(request.request.params.has('modality')).toBe(false);
    expect(request.request.params.has('salaryCurrency')).toBe(false);
    request.flush(emptyResponse);
    await pending;
  });
});
