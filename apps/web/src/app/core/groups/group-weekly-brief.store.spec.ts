import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiError, providePageTesting, sessionWith, verifyNoPendingRequests } from '../../../testing/auth-testing';
import { EMPTY_GROUP_BRIEF, groupBriefResponse } from '../../../testing/group-brief-testing';
import { SessionStore } from '../auth/session.store';
import { GroupWeeklyBriefStore } from './group-weekly-brief.store';

const URL_G1 = '/api/groups/g1/weekly-brief';

describe('GroupWeeklyBriefStore', () => {
  let store: GroupWeeklyBriefStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    store = TestBed.inject(GroupWeeklyBriefStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('loads the brief', async () => {
    const loading = store.load('g1');
    expect(store.status()).toBe('loading');
    http.expectOne(URL_G1).flush(groupBriefResponse());
    await loading;

    expect(store.status()).toBe('ready');
    expect(store.response()).toEqual(groupBriefResponse());
  });

  it('keeps an empty week as ready with a null brief', async () => {
    const loading = store.load('g1');
    http.expectOne(URL_G1).flush(EMPTY_GROUP_BRIEF);
    await loading;

    expect(store.status()).toBe('ready');
    expect(store.response()?.brief).toBeNull();
  });

  it('invalid payload is an error', async () => {
    const loading = store.load('g1');
    http.expectOne(URL_G1).flush({ weekKey: 'no-week', brief: null });
    await loading;

    expect(store.status()).toBe('error');
    expect(store.response()).toBeNull();
  });

  it('retry after error loads the brief', async () => {
    const failing = store.load('g1');
    const { body, options } = apiError('internal_error', 500);
    http.expectOne(URL_G1).flush(body, { status: options.status, statusText: options.statusText });
    await failing;
    expect(store.status()).toBe('error');

    const retrying = store.retry();
    expect(store.status()).toBe('loading');
    http.expectOne(URL_G1).flush(groupBriefResponse());
    await retrying;

    expect(store.status()).toBe('ready');
    expect(store.response()?.brief?.openOffers).toBe(7);
  });

  it('ignores a slow answer from the previous group', async () => {
    const first = store.load('g1');
    const second = store.load('g2');
    http.expectOne(URL_G1).flush(groupBriefResponse());
    http.expectOne('/api/groups/g2/weekly-brief').flush(EMPTY_GROUP_BRIEF);
    await Promise.all([first, second]);

    expect(store.groupId()).toBe('g2');
    expect(store.response()).toEqual(EMPTY_GROUP_BRIEF);
  });
});
