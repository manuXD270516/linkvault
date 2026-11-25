import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { providePageTesting, sessionWith, verifyNoPendingRequests } from '../../../testing/auth-testing';
import { EMPTY_GROUP_BRIEF, groupBriefResponse } from '../../../testing/group-brief-testing';
import { SessionStore } from '../auth/session.store';
import { GroupWeeklyBriefApi } from './group-weekly-brief.api';

describe('GroupWeeklyBriefApi', () => {
  let api: GroupWeeklyBriefApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(GroupWeeklyBriefApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('parses a brief', async () => {
    const result = api.get('g1');
    const request = http.expectOne('/api/groups/g1/weekly-brief');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush(groupBriefResponse());

    await expect(result).resolves.toEqual(groupBriefResponse());
  });

  it('parses an empty week', async () => {
    const result = api.get('g1');
    http.expectOne('/api/groups/g1/weekly-brief').flush(EMPTY_GROUP_BRIEF);

    await expect(result).resolves.toEqual(EMPTY_GROUP_BRIEF);
  });

  it('invalid payload is an error', async () => {
    const result = api.get('g1');
    http.expectOne('/api/groups/g1/weekly-brief').flush({ weekKey: '2026-W48', brief: { asOf: 'ayer' } });

    await expect(result).rejects.toThrow();
  });
});
