import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { GroupDetail, GroupMember, GroupSummary } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { GroupsApi, normalizeInviteCode } from './groups.api';

const detail: GroupDetail = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'owner',
  memberCount: 1,
  createdAt: '2026-09-17T10:00:00.000Z',
  inviteCode: 'ABCD2345',
};

const summary: GroupSummary = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'member',
  memberCount: 2,
  joinedAt: '2026-09-17T10:00:00.000Z',
};

const member: GroupMember = {
  userId: 'u1',
  displayName: 'Ana',
  role: 'owner',
  joinedAt: '2026-09-17T10:00:00.000Z',
};

describe('GroupsApi', () => {
  let api: GroupsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(GroupsApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  /** Toda petición de grupos lleva el Bearer que pone el interceptor. */
  function expectRequest(method: string, url: string): ReturnType<HttpTestingController['expectOne']> {
    const request = http.expectOne(url);
    expect(request.request.method).toBe(method);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    return request;
  }

  it('creates a group', async () => {
    const result = api.createGroup('Backend Bolivia');

    const request = expectRequest('POST', '/api/groups');
    expect(request.request.body).toEqual({ name: 'Backend Bolivia' });
    request.flush(detail, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(detail);
  });

  it('lists the groups of the user', async () => {
    const result = api.listGroups();

    expectRequest('GET', '/api/groups').flush([summary]);

    await expect(result).resolves.toEqual([summary]);
  });

  it('gets the detail of a group', async () => {
    const result = api.getGroup('g1');

    expectRequest('GET', '/api/groups/g1').flush(detail);

    await expect(result).resolves.toEqual(detail);
  });

  it('renames a group', async () => {
    const result = api.renameGroup('g1', 'Backend LatAm');

    const request = expectRequest('PATCH', '/api/groups/g1');
    expect(request.request.body).toEqual({ name: 'Backend LatAm' });
    request.flush({ ...detail, name: 'Backend LatAm' });

    await expect(result).resolves.toMatchObject({ name: 'Backend LatAm' });
  });

  it('deletes a group', async () => {
    const result = api.deleteGroup('g1');

    expectRequest('DELETE', '/api/groups/g1').flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  it('rotates the invite code', async () => {
    const result = api.rotateInviteCode('g1');

    expectRequest('POST', '/api/groups/g1/invite-code').flush({ inviteCode: 'WXYZ6789' });

    await expect(result).resolves.toEqual({ inviteCode: 'WXYZ6789' });
  });

  it('normalizes the invite code before sending it', async () => {
    const result = api.joinGroup(' abcd2345 ');

    const request = expectRequest('POST', '/api/groups/join');
    expect(request.request.body).toEqual({ code: 'ABCD2345' });
    request.flush(summary);

    await expect(result).resolves.toEqual(summary);
  });

  it('lists the members of a group', async () => {
    const result = api.listMembers('g1');

    expectRequest('GET', '/api/groups/g1/members').flush([member]);

    await expect(result).resolves.toEqual([member]);
  });

  it('leaves a group', async () => {
    const result = api.leaveGroup('g1');

    expectRequest('DELETE', '/api/groups/g1/members/me').flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('removes a member', async () => {
    const result = api.removeMember('g1', 'u2');

    expectRequest('DELETE', '/api/groups/g1/members/u2').flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('propagates the API error without swallowing it', async () => {
    const result = api.joinGroup('ABCD2345');

    expectRequest('POST', '/api/groups/join').flush(
      { code: 'invalid_invite_code', message: 'Invalid code' },
      { status: 404, statusText: 'Not Found' },
    );

    await expect(result).rejects.toMatchObject({ status: 404 });
  });
});

describe('normalizeInviteCode', () => {
  it('trims and upper cases the code', () => {
    expect(normalizeInviteCode(' abcd2345 ')).toBe('ABCD2345');
    expect(normalizeInviteCode('ABC-12')).toBe('ABC-12');
    expect(normalizeInviteCode('   ')).toBe('');
  });
});
