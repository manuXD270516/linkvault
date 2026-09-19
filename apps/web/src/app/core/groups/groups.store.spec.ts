import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { GroupDetail, GroupSummary } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { GroupsStore } from './groups.store';

const backend: GroupSummary = {
  id: 'g1',
  name: 'Backend Bolivia',
  role: 'owner',
  memberCount: 3,
  joinedAt: '2026-09-17T10:00:00.000Z',
};

const frontend: GroupSummary = {
  id: 'g2',
  name: 'Frontend Bolivia',
  role: 'member',
  memberCount: 2,
  joinedAt: '2026-09-16T10:00:00.000Z',
};

const created: GroupDetail = {
  id: 'g3',
  name: 'Data LatAm',
  role: 'owner',
  memberCount: 1,
  createdAt: '2026-09-17T11:00:00.000Z',
  inviteCode: 'ABCD2345',
};

describe('GroupsStore', () => {
  let store: GroupsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    store = TestBed.inject(GroupsStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  /** Espera a que la acción encadene la recarga y la responde con `groups`. */
  async function flushList(groups: GroupSummary[]): Promise<void> {
    await settle();
    http.expectOne({ method: 'GET', url: '/api/groups' }).flush(groups);
  }

  it('loads the list and marks it as loaded', async () => {
    const loading = store.load();
    expect(store.loading()).toBe(true);
    expect(store.loaded()).toBe(false);

    await flushList([backend, frontend]);
    await loading;

    expect(store.groups()).toEqual([backend, frontend]);
    expect(store.loaded()).toBe(true);
    expect(store.loading()).toBe(false);
    expect(store.failure()).toBeNull();
    expect(store.isEmpty()).toBe(false);
  });

  it('reports an empty list only once loaded', async () => {
    expect(store.isEmpty()).toBe(false);

    const loading = store.load();
    await flushList([]);
    await loading;

    expect(store.isEmpty()).toBe(true);
  });

  it('keeps the failure of a failed load without rejecting', async () => {
    const loading = store.load();

    http
      .expectOne('/api/groups')
      .flush({ code: 'internal_error', message: 'Boom' }, { status: 500, statusText: 'Error' });
    await expect(loading).resolves.toBeUndefined();

    expect(store.failure()).toEqual({
      kind: 'api',
      status: 500,
      code: 'internal_error',
      retryAfterMinutes: null,
    });
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(false);
  });

  it('reloads the list after creating a group', async () => {
    const creating = store.create('Data LatAm');

    const request = http.expectOne({ method: 'POST', url: '/api/groups' });
    expect(request.request.body).toEqual({ name: 'Data LatAm' });
    request.flush(created, { status: 201, statusText: 'Created' });
    await flushList([backend, frontend]);

    await expect(creating).resolves.toEqual(created);
    expect(store.groups()).toEqual([backend, frontend]);
  });

  it('reloads the list after joining with a code', async () => {
    const joining = store.join(' abcd2345 ');

    const request = http.expectOne('/api/groups/join');
    expect(request.request.body).toEqual({ code: 'ABCD2345' });
    request.flush(frontend);
    await flushList([frontend]);

    await expect(joining).resolves.toEqual(frontend);
    expect(store.groups()).toEqual([frontend]);
  });

  it('reloads the list after leaving, deleting and removing a member', async () => {
    for (const [start, url] of [
      [() => store.leave('g2'), '/api/groups/g2/members/me'],
      [() => store.remove('g1'), '/api/groups/g1'],
      [() => store.removeMember('g1', 'u2'), '/api/groups/g1/members/u2'],
    ] as const) {
      const action = start();

      http
        .expectOne({ method: 'DELETE', url })
        .flush(null, { status: 204, statusText: 'No Content' });
      await flushList([backend]);

      await expect(action).resolves.toBeUndefined();
      expect(store.groups()).toEqual([backend]);
    }
  });

  it('reloads the list after transferring the ownership', async () => {
    const asMember: GroupDetail = {
      id: 'g1',
      name: 'Backend Bolivia',
      role: 'member',
      memberCount: 3,
      createdAt: '2026-09-17T10:00:00.000Z',
    };
    const transferring = store.transferOwnership('g1', 'u2');

    const request = http.expectOne({ method: 'POST', url: '/api/groups/g1/owner' });
    expect(request.request.body).toEqual({ userId: 'u2' });
    request.flush(asMember);
    await flushList([{ ...backend, role: 'member' }]);

    await expect(transferring).resolves.toEqual(asMember);
    expect(store.groups()).toEqual([{ ...backend, role: 'member' }]);
  });

  it('propagates the error of an action without reloading the list', async () => {
    const creating = store.create('Data LatAm');

    http
      .expectOne('/api/groups')
      .flush(
        { code: 'too_many_groups', message: 'Too many groups' },
        { status: 409, statusText: 'Conflict' },
      );

    await expect(creating).rejects.toMatchObject({ status: 409 });
    await settle();
    http.expectNone('/api/groups');
  });

  it('forgets a group that no longer belongs to the user', async () => {
    const loading = store.load();
    await flushList([backend, frontend]);
    await loading;

    store.forget('g1');

    expect(store.groups()).toEqual([frontend]);
    http.expectNone('/api/groups');
  });
});
