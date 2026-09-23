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

  it('setMinSalary forces job_preview and clears applicationStatus (D3b)', () => {
    store.setApplicationStatus('applied');
    expect(store.docType()).toBe('application');

    store.setMinSalary(3000);

    expect(store.minSalary()).toBe(3000);
    expect(store.docType()).toBe('job_preview');
    expect(store.applicationStatus()).toBeNull();
  });

  it('setMaxSalary forces job_preview and clears applicationStatus (D3b)', () => {
    store.setApplicationStatus('applied');
    store.setMaxSalary(8000);

    expect(store.maxSalary()).toBe(8000);
    expect(store.docType()).toBe('job_preview');
    expect(store.applicationStatus()).toBeNull();
  });

  it('setApplicationStatus clears salary range (D3b bidirectional)', () => {
    store.setMinSalary(3000);
    store.setMaxSalary(8000);
    expect(store.minSalary()).toBe(3000);
    expect(store.maxSalary()).toBe(8000);

    store.setApplicationStatus('applied');

    expect(store.applicationStatus()).toBe('applied');
    expect(store.docType()).toBe('application');
    expect(store.minSalary()).toBeNull();
    expect(store.maxSalary()).toBeNull();
  });

  it('run sends minSalary and maxSalary with forced job_preview and without applicationStatus', async () => {
    store.setMinSalary(3000);
    store.setMaxSalary(8000);
    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('q')).toBe('Nest');
    expect(request.request.params.get('docType')).toBe('job_preview');
    expect(request.request.params.get('minSalary')).toBe('3000');
    expect(request.request.params.get('maxSalary')).toBe('8000');
    expect(request.request.params.has('applicationStatus')).toBe(false);
    request.flush(emptyResponse);
    await pending;
  });

  it('run re-forces job_preview when user changed type after salary range (D3b)', async () => {
    store.setMinSalary(3000);
    store.setDocType('application');
    expect(store.docType()).toBe('application');

    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('docType')).toBe('job_preview');
    expect(request.request.params.get('minSalary')).toBe('3000');
    request.flush(emptyResponse);
    await pending;
    expect(store.docType()).toBe('job_preview');
  });

  it('run omits salary range when both sides are empty', async () => {
    expect(store.minSalary()).toBeNull();
    expect(store.maxSalary()).toBeNull();
    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.has('minSalary')).toBe(false);
    expect(request.request.params.has('maxSalary')).toBe(false);
    request.flush(emptyResponse);
    await pending;
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

  it('run re-forces docType when user changed type after LatAm filter (D3b)', async () => {
    store.setModality('remote');
    store.setDocType('application');
    expect(store.docType()).toBe('application');

    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('docType')).toBe('job_preview');
    expect(request.request.params.get('modality')).toBe('remote');
    request.flush(emptyResponse);
    await pending;
    expect(store.docType()).toBe('job_preview');
  });

  it('setOpenOnly forces job_preview and clears applicationStatus (D3b)', () => {
    store.setApplicationStatus('applied');
    expect(store.docType()).toBe('application');

    store.setOpenOnly(true);

    expect(store.openOnly()).toBe(true);
    expect(store.docType()).toBe('job_preview');
    expect(store.applicationStatus()).toBeNull();
  });

  it('setApplicationStatus clears openOnly (D3b bidirectional)', () => {
    store.setOpenOnly(true);
    expect(store.openOnly()).toBe(true);

    store.setApplicationStatus('applied');

    expect(store.applicationStatus()).toBe('applied');
    expect(store.docType()).toBe('application');
    expect(store.openOnly()).toBe(false);
  });

  it('run sends openOnly=true with forced job_preview and without applicationStatus', async () => {
    store.setOpenOnly(true);
    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.get('q')).toBe('Nest');
    expect(request.request.params.get('docType')).toBe('job_preview');
    expect(request.request.params.get('openOnly')).toBe('true');
    expect(request.request.params.has('applicationStatus')).toBe(false);
    request.flush(emptyResponse);
    await pending;
  });

  it('run omits openOnly when toggle is off', async () => {
    expect(store.openOnly()).toBe(false);
    const pending = store.run('Nest');

    const request = http.expectOne(
      (req) => req.method === 'GET' && req.url === '/api/search',
    );
    expect(request.request.params.has('openOnly')).toBe(false);
    request.flush(emptyResponse);
    await pending;
  });
});
