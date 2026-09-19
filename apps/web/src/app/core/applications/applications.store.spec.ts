import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  Application,
  ApplicationListResponse,
  GroupTrackersResponse,
  TrackLinkResponse,
} from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { applicationWith, trackerWith } from '../../../testing/applications-testing';
import { SessionStore } from '../auth/session.store';
import { ApplicationsStore } from './applications.store';

const beto = trackerWith();

describe('ApplicationsStore', () => {
  let store: ApplicationsStore;
  let http: HttpTestingController;
  let session: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    session = TestBed.inject(SessionStore);
    session.setSession(sessionWith('token-1'));
    store = TestBed.inject(ApplicationsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function loadBoard(items: Application[]): Promise<void> {
    const loading = store.loadBoard();
    http.expectOne('/api/applications').flush({ items } satisfies ApplicationListResponse);
    await loading;
  }

  async function loadShared(
    groupId: string,
    linkIds: string[],
    items: GroupTrackersResponse['items'],
  ): Promise<void> {
    const loading = store.loadShared(groupId, linkIds);
    http
      .expectOne(`/api/groups/${groupId}/applications?linkIds=${linkIds.join(',')}`)
      .flush({ items } satisfies GroupTrackersResponse);
    await loading;
  }

  describe('API calls', () => {
    it('loads the whole board, most recently changed first', async () => {
      await loadBoard([
        applicationWith({ linkId: 'l1', updatedAt: '2026-09-18T09:00:00.000Z' }),
        applicationWith({ linkId: 'l2', updatedAt: '2026-09-18T11:00:00.000Z' }),
      ]);

      expect(store.boardLoaded()).toBe(true);
      expect(store.applications().map((item) => item.linkId)).toEqual(['l2', 'l1']);
    });

    it('keeps the failure of the board without throwing', async () => {
      const loading = store.loadBoard();
      http.expectOne('/api/applications').flush(null, { status: 500, statusText: 'Error' });
      await loading;

      expect(store.boardLoaded()).toBe(false);
      expect(store.boardFailure()).toEqual(
        expect.objectContaining({ kind: 'api', status: 500 }),
      );
    });

    it('asks for the own state of a set of links in blocks of up to 50', async () => {
      const ids = Array.from({ length: 60 }, (_, index) => `l${index}`);
      const loading = store.loadOwn(ids);

      const requests = http.match((request) => request.url === '/api/applications');
      expect(requests.map((request) => request.request.params.get('linkIds'))).toEqual([
        ids.slice(0, 50).join(','),
        ids.slice(50).join(','),
      ]);
      requests[0].flush({ items: [applicationWith({ linkId: 'l3' })] });
      requests[1].flush({ items: [] });
      await loading;

      expect(Object.keys(store.byLinkId())).toEqual(['l3']);
    });

    it('tracks a link with the status of the gesture and keeps the response', async () => {
      const tracking = store.track('l1', 'applied');
      const request = http.expectOne({ method: 'POST', url: '/api/applications' });
      expect(request.request.body).toEqual({ linkId: 'l1', status: 'applied' });
      request.flush({
        application: applicationWith({ status: 'applied', appliedAt: '2026-09-18T10:00:00.000Z' }),
        created: true,
      } satisfies TrackLinkResponse);
      const response = await tracking;

      expect(response.created).toBe(true);
      expect(store.byLinkId()['l1'].status).toBe('applied');
    });

    it('sends the date of another day when tracking', async () => {
      const tracking = store.track('l1', 'applied', '2026-09-12T04:00:00.000Z');
      const request = http.expectOne({ method: 'POST', url: '/api/applications' });
      expect(request.request.body).toEqual({
        linkId: 'l1',
        status: 'applied',
        appliedAt: '2026-09-12T04:00:00.000Z',
      });
      request.flush({ application: applicationWith({ status: 'applied' }), created: true });
      await tracking;
    });

    it('changes the status with the painted version', async () => {
      await loadBoard([applicationWith({ version: 3 })]);

      const changing = store.changeStatus(store.byLinkId()['l1'], {
        status: 'in_process',
        stageLabel: 'Entrevista',
      });
      const request = http.expectOne({ method: 'PATCH', url: '/api/applications/a-l1/status' });
      expect(request.request.body).toEqual({
        status: 'in_process',
        stageLabel: 'Entrevista',
        version: 3,
      });
      request.flush(applicationWith({ status: 'in_process', stageLabel: 'Entrevista', version: 4 }));

      expect(await changing).toEqual(expect.objectContaining({ version: 4 }));
      expect(store.byLinkId()['l1'].stageLabel).toBe('Entrevista');
    });

    it('reloads the board and propagates a conflict', async () => {
      await loadBoard([applicationWith({ version: 1 })]);

      const changing = store.changeStatus(store.byLinkId()['l1'], { status: 'offer' });
      const { body, options } = apiError('application_conflict', 409);
      http.expectOne('/api/applications/a-l1/status').flush(body, options);
      await settle();
      http
        .expectOne('/api/applications')
        .flush({ items: [applicationWith({ status: 'in_process', version: 2 })] });

      await expect(changing).rejects.toMatchObject({ status: 409 });
      expect(store.byLinkId()['l1']).toEqual(
        expect.objectContaining({ status: 'in_process', version: 2 }),
      );
    });

    it('reloads only that link after a conflict outside the board', async () => {
      const tracking = store.track('l1', 'interested');
      http.expectOne('/api/applications').flush({ application: applicationWith(), created: true });
      await tracking;

      const changing = store.changeStatus(store.byLinkId()['l1'], { status: 'applied' });
      const { body, options } = apiError('application_conflict', 409);
      http.expectOne('/api/applications/a-l1/status').flush(body, options);
      await settle();
      http
        .expectOne('/api/applications?linkIds=l1')
        .flush({ items: [applicationWith({ status: 'offer', version: 2 })] });

      await expect(changing).rejects.toMatchObject({ status: 409 });
      expect(store.byLinkId()['l1'].status).toBe('offer');
    });

    it('updates notes and visibility without a version', async () => {
      await loadBoard([applicationWith()]);

      const updating = store.update({ id: 'a-l1', linkId: 'l1' }, { notes: 'Piden inglés C1' });
      const request = http.expectOne({ method: 'PATCH', url: '/api/applications/a-l1' });
      expect(request.request.body).toEqual({ notes: 'Piden inglés C1' });
      request.flush(applicationWith({ notes: 'Piden inglés C1' }));
      await updating;

      expect(store.byLinkId()['l1'].notes).toBe('Piden inglés C1');
    });

    it('untracks and forgets the application', async () => {
      await loadBoard([applicationWith()]);

      const untracking = store.untrack({ id: 'a-l1', linkId: 'l1' });
      http
        .expectOne({ method: 'DELETE', url: '/api/applications/a-l1' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await untracking;

      expect(store.applications()).toEqual([]);
    });

    it('reads the timeline', async () => {
      const reading = store.timeline({ id: 'a-l1', linkId: 'l1' });
      http.expectOne('/api/applications/a-l1/events').flush({
        items: [{ id: 'e1', to: 'interested', at: '2026-09-18T10:00:00.000Z' }],
      });

      expect(await reading).toEqual([{ id: 'e1', to: 'interested', at: '2026-09-18T10:00:00.000Z' }]);
    });

    it('propagates any other error', async () => {
      await loadBoard([applicationWith()]);

      const updating = store.update({ id: 'a-l1', linkId: 'l1' }, { notes: 'x' });
      http.expectOne('/api/applications/a-l1').flush(null, { status: 500, statusText: 'Error' });

      await expect(updating).rejects.toMatchObject({ status: 500 });
      expect(store.byLinkId()['l1']).toBeDefined();
    });
  });

  describe('session and stale entries', () => {
    it('Cambio de usuario', async () => {
      await loadBoard([applicationWith()]);
      await loadShared('g1', ['l1'], [{ linkId: 'l1', trackers: [beto] }]);

      session.clear();
      TestBed.tick();
      session.setSession(
        sessionWith('token-2', { ...testUser, id: 'u9', displayName: 'Beto', email: 'b@example.com' }),
      );
      TestBed.tick();

      expect(store.userId()).toBe('u9');
      expect(store.applications()).toEqual([]);
      expect(store.shared()).toEqual({});
      expect(store.boardLoaded()).toBe(false);
    });

    it('drops a response that arrives after the user changed', async () => {
      const loading = store.loadBoard();
      session.clear();
      TestBed.tick();

      http.expectOne('/api/applications').flush({ items: [applicationWith()] });
      await loading;

      expect(store.applications()).toEqual([]);
    });

    it('Dejó de seguirla en otra pestaña', async () => {
      const first = store.loadOwn(['l1', 'l2']);
      http
        .expectOne('/api/applications?linkIds=l1,l2')
        .flush({ items: [applicationWith({ linkId: 'l1' }), applicationWith({ linkId: 'l2' })] });
      await first;

      const again = store.loadOwn(['l1', 'l2']);
      http
        .expectOne('/api/applications?linkIds=l1,l2')
        .flush({ items: [applicationWith({ linkId: 'l2' })] });
      await again;

      expect(store.byLinkId()['l1']).toBeUndefined();
      expect(store.byLinkId()['l2']).toBeDefined();
    });

    it('Postulación que ya no existe', async () => {
      await loadBoard([applicationWith()]);

      const changing = store.changeStatus(store.byLinkId()['l1'], { status: 'applied' });
      const { body, options } = apiError('application_not_found', 404);
      http.expectOne('/api/applications/a-l1/status').flush(body, options);

      expect(await changing).toBeNull();
      expect(store.applications()).toEqual([]);
    });

    it('removes the entry on a 404 when sharing, reading the timeline or untracking', async () => {
      const { body, options } = apiError('application_not_found', 404);

      await loadBoard([applicationWith()]);
      const updating = store.update({ id: 'a-l1', linkId: 'l1' }, { visibility: 'group' });
      http.expectOne('/api/applications/a-l1').flush(body, options);
      expect(await updating).toBeNull();
      expect(store.applications()).toEqual([]);

      await loadBoard([applicationWith()]);
      const reading = store.timeline({ id: 'a-l1', linkId: 'l1' });
      http.expectOne('/api/applications/a-l1/events').flush(body, options);
      expect(await reading).toBeNull();
      expect(store.applications()).toEqual([]);

      await loadBoard([applicationWith()]);
      const untracking = store.untrack({ id: 'a-l1', linkId: 'l1' });
      http.expectOne('/api/applications/a-l1').flush(body, options);
      await untracking;
      expect(store.applications()).toEqual([]);
    });

    it('does not remove a newer application of the same link on a stale 404', async () => {
      await loadBoard([applicationWith({ id: 'a-new' })]);

      const updating = store.update({ id: 'a-old', linkId: 'l1' }, { visibility: 'group' });
      const { body, options } = apiError('application_not_found', 404);
      http.expectOne('/api/applications/a-old').flush(body, options);
      await updating;

      expect(store.byLinkId()['l1'].id).toBe('a-new');
    });
  });

  describe('own avatar in the shared states', () => {
    it('keeps the links of the group, also without anyone sharing, and forgets the ones that left', async () => {
      await loadShared('g1', ['l1', 'l2'], [
        { linkId: 'l1', trackers: [beto] },
        { linkId: 'l2', trackers: [] },
      ]);
      await loadShared('g1', ['l1', 'l2'], [{ linkId: 'l1', trackers: [] }]);

      expect(store.shared()['g1']).toEqual({ l1: [] });
    });

    it('Mi avatar al momento', async () => {
      await loadShared('g1', ['l1', 'l2'], [
        { linkId: 'l1', trackers: [beto] },
        { linkId: 'l2', trackers: [] },
      ]);
      await loadShared('g2', ['l1'], [{ linkId: 'l1', trackers: [] }]);
      const tracking = store.track('l1', 'interested');
      http.expectOne('/api/applications').flush({ application: applicationWith(), created: true });
      await tracking;
      expect(store.shared()['g1']['l1']).toEqual([beto]);

      const sharing = store.update({ id: 'a-l1', linkId: 'l1' }, { visibility: 'group' });
      http.expectOne('/api/applications/a-l1').flush(applicationWith({ visibility: 'group' }));
      await sharing;

      const ana = { userId: 'u1', displayName: 'Ana', status: 'interested' };
      expect(store.shared()['g1']['l1']).toEqual([ana, beto]);
      expect(store.shared()['g2']['l1']).toEqual([ana]);
      expect(store.shared()['g1']['l2']).toEqual([]);

      const untracking = store.untrack({ id: 'a-l1', linkId: 'l1' });
      http
        .expectOne({ method: 'DELETE', url: '/api/applications/a-l1' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await untracking;

      expect(store.shared()['g1']['l1']).toEqual([beto]);
      expect(store.shared()['g2']['l1']).toEqual([]);
      http.expectNone((request) => request.url.startsWith('/api/groups/'));
    });

    it('hides the own avatar when sharing stops and moves it first when the status changes', async () => {
      await loadShared('g1', ['l1'], [
        { linkId: 'l1', trackers: [{ ...beto, status: 'applied' }, { userId: 'u1', displayName: 'Ana', status: 'interested' }] },
      ]);
      await loadBoard([applicationWith({ visibility: 'group' })]);

      const changing = store.changeStatus(store.byLinkId()['l1'], { status: 'offer' });
      http
        .expectOne('/api/applications/a-l1/status')
        .flush(applicationWith({ visibility: 'group', status: 'offer', version: 2 }));
      await changing;
      expect(store.shared()['g1']['l1'].map((tracker) => tracker.status)).toEqual([
        'offer',
        'applied',
      ]);

      const hiding = store.update({ id: 'a-l1', linkId: 'l1' }, { visibility: 'private' });
      http
        .expectOne('/api/applications/a-l1')
        .flush(applicationWith({ visibility: 'private', status: 'offer', version: 2 }));
      await hiding;
      expect(store.shared()['g1']['l1']).toEqual([{ ...beto, status: 'applied' }]);
      http.expectNone((request) => request.url.startsWith('/api/groups/'));
    });
  });
});
