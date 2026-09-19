import { HttpEventType } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  CommentsSummary,
  GroupLinkComment,
  GroupLinkCommentsMessage,
  JobLinkSummary,
  LinkPage,
} from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { EventsChannel } from '../events/events.channel';
import { LinksStore } from './links.store';

function linkWith(id: string): JobLinkSummary {
  return {
    id,
    normalizedUrl: `https://www.linkedin.com/jobs/view/${id}`,
    displayUrl: `https://www.linkedin.com/jobs/view/${id}/?utm_source=share`,
    platform: 'linkedin',
    previewStatus: 'pending',
    previewVersion: 1,
    sharedBy: { userId: 'u1', displayName: 'Ana' },
    sharedAt: '2026-09-17T10:00:00.000Z',
  };
}

const SHARED_AT = '2026-09-17T10:00:00.000Z';

function commentWith(id: string, text: string, displayName = 'Beto'): GroupLinkComment {
  return {
    id,
    author: { userId: `u-${displayName}`, displayName },
    authorLeft: false,
    text,
    createdAt: '2026-09-19T10:00:00.000Z',
  };
}

function summaryWith(
  revision: number,
  latest: GroupLinkComment[],
  count = latest.length,
  sharedAt = SHARED_AT,
): CommentsSummary {
  return { count, revision, sharedAt, latest };
}

/** Un link del grupo con nota y dos comentarios, como lo trae el listado del grupo. */
function linkWithContext(id: string, revision = 2): JobLinkSummary {
  return {
    ...linkWith(id),
    note: { text: 'Esta es la que te dije', createdAt: SHARED_AT },
    comments: summaryWith(revision, [
      commentWith('c2', 'Ya cerró'),
      commentWith('c1', 'Piden inglés C1'),
    ]),
  };
}

function noticeFor(
  linkId: string,
  comments: CommentsSummary,
  groupId = 'g1',
): GroupLinkCommentsMessage {
  return { groupId, linkId, change: 'created', commentId: comments.latest[0]?.id ?? 'c0', comments };
}

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const OTHER_GROUP_PAGE = '/api/groups/g2/links?limit=20';
const GROUP_A = { kind: 'group', groupId: 'g1' } as const;
const GROUP_B = { kind: 'group', groupId: 'g2' } as const;
const NOT_FOUND = { status: 404, statusText: 'Not Found' } as const;
const NOT_FOUND_BODY = { code: 'group_not_found', message: 'Not found' } as const;

/** Un link ya leído: una página solo con links así no abre el contador de lecturas. */
function readLinkWith(id: string, sharedBy = 'Ana'): JobLinkSummary {
  return {
    ...linkWith(id),
    previewStatus: 'enriched',
    sharedBy: { userId: `u-${sharedBy}`, displayName: sharedBy },
  };
}
const MINE_PAGE = '/api/links/mine?limit=20';

describe('LinksStore', () => {
  let store: LinksStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    store = TestBed.inject(LinksStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  /** Espera a que la acción encadene la recarga y la responde con `page`. */
  async function flushPage(url: string, page: LinkPage): Promise<void> {
    await settle();
    http.expectOne(url).flush(page);
  }

  async function openGroup(page: LinkPage): Promise<void> {
    const opening = store.open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush(page);
    await opening;
  }

  it('loads the first page of a group and marks it as loaded', async () => {
    const opening = store.open({ kind: 'group', groupId: 'g1' });
    expect(store.loading()).toBe(true);
    expect(store.loaded()).toBe(false);

    http
      .expectOne(GROUP_PAGE)
      .flush({ items: [linkWith('l1'), linkWith('l2')], total: 2 } satisfies LinkPage);
    await opening;

    expect(store.items().map((item) => item.id)).toEqual(['l1', 'l2']);
    expect(store.total()).toBe(2);
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(true);
    expect(store.isEmpty()).toBe(false);
    expect(store.hasMore()).toBe(false);
    expect(store.failure()).toBeNull();
  });

  it('never saves or imports without an open list', async () => {
    await expect(store.save('https://www.linkedin.com/jobs/view/3912345678/')).rejects.toThrow(
      'No list is open',
    );
    await expect(store.importText('https://www.linkedin.com/jobs/view/3912345678/')).rejects.toThrow(
      'No list is open',
    );

    http.expectNone({ method: 'POST', url: '/api/links' });
    http.expectNone({ method: 'POST', url: '/api/links/import' });
  });

  it('reports an empty list only once loaded', async () => {
    expect(store.isEmpty()).toBe(false);

    await openGroup({ items: [], total: 0 });

    expect(store.isEmpty()).toBe(true);
  });

  it('appends the next page with the cursor of the previous one', async () => {
    await openGroup({ items: [linkWith('l1')], total: 3, nextCursor: 'Y3Vyc29y' });
    expect(store.hasMore()).toBe(true);

    const more = store.loadMore();
    http
      .expectOne('/api/groups/g1/links?limit=20&cursor=Y3Vyc29y')
      .flush({ items: [linkWith('l2'), linkWith('l3')], total: 3 } satisfies LinkPage);
    await more;

    expect(store.items().map((item) => item.id)).toEqual(['l1', 'l2', 'l3']);
    expect(store.hasMore()).toBe(false);
  });

  it('does not ask for more pages when there is no cursor', async () => {
    await openGroup({ items: [linkWith('l1')], total: 1 });

    await store.loadMore();

    http.expectNone(() => true);
  });

  it('keeps the failure of a failed load without rejecting', async () => {
    const opening = store.open({ kind: 'group', groupId: 'g1' });

    http
      .expectOne(GROUP_PAGE)
      .flush(
        { code: 'group_not_found', message: 'Not found' },
        { status: 404, statusText: 'Not Found' },
      );
    await expect(opening).resolves.toBeUndefined();

    expect(store.failure()).toEqual({
      kind: 'api',
      status: 404,
      code: 'group_not_found',
      retryAfterMinutes: null,
    });
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(false);
  });

  it('reloads the list after saving a link in the group', async () => {
    await openGroup({ items: [], total: 0 });

    const saving = store.save('https://ejemplo.test/oferta');
    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(request.request.body).toEqual({ url: 'https://ejemplo.test/oferta', groupId: 'g1' });
    request.flush(
      { link: linkWith('l1'), created: true, shared: 'created', alreadyInGroups: [] },
      { status: 201, statusText: 'Created' },
    );
    await flushPage(GROUP_PAGE, { items: [linkWith('l1')], total: 1 });

    await expect(saving).resolves.toMatchObject({ created: true, shared: 'created' });
    expect(store.items().map((item) => item.id)).toEqual(['l1']);
    expect(store.total()).toBe(1);
  });

  it('reloads the list after importing a text', async () => {
    await openGroup({ items: [], total: 0 });

    const importing = store.importText('mira esto https://ejemplo.test/oferta');
    const request = http.expectOne({ method: 'POST', url: '/api/links/import' });
    expect(request.request.body).toEqual({
      text: 'mira esto https://ejemplo.test/oferta',
      groupId: 'g1',
    });
    request.flush(
      { created: 1, existing: 0, unrecognized: 0, skipped: 0, links: [linkWith('l1')] },
      { status: 201, statusText: 'Created' },
    );
    await flushPage(GROUP_PAGE, { items: [linkWith('l1')], total: 1 });

    await expect(importing).resolves.toMatchObject({ created: 1 });
    expect(store.items().map((item) => item.id)).toEqual(['l1']);
  });

  it('reloads the list from the first page after removing a link of the group', async () => {
    await openGroup({ items: [linkWith('l1')], total: 2, nextCursor: 'Y3Vyc29y' });

    const removing = store.remove('l1');
    http
      .expectOne({ method: 'DELETE', url: '/api/groups/g1/links/l1' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await flushPage(GROUP_PAGE, { items: [linkWith('l2')], total: 1 });

    await expect(removing).resolves.toBeUndefined();
    expect(store.items().map((item) => item.id)).toEqual(['l2']);
    expect(store.hasMore()).toBe(false);
  });

  it('uses the private endpoints when the list has no group', async () => {
    const opening = store.open({ kind: 'mine' });
    http.expectOne(MINE_PAGE).flush({ items: [linkWith('l1')], total: 1 } satisfies LinkPage);
    await opening;

    const saving = store.save('https://ejemplo.test/oferta');
    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(request.request.body).toEqual({ url: 'https://ejemplo.test/oferta' });
    request.flush(
      { link: linkWith('l2'), created: true, shared: 'created', alreadyInGroups: [] },
      { status: 201, statusText: 'Created' },
    );
    await flushPage(MINE_PAGE, { items: [linkWith('l2'), linkWith('l1')], total: 2 });
    await saving;

    const removing = store.remove('l1');
    http
      .expectOne({ method: 'DELETE', url: '/api/links/mine/l1' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await flushPage(MINE_PAGE, { items: [linkWith('l2')], total: 1 });

    await expect(removing).resolves.toBeUndefined();
    expect(store.items().map((item) => item.id)).toEqual(['l2']);
  });

  it('propagates the error of an action without reloading the list', async () => {
    await openGroup({ items: [linkWith('l1')], total: 1 });

    const saving = store.save('no-es-una-url');
    http
      .expectOne({ method: 'POST', url: '/api/links' })
      .flush(
        { code: 'invalid_url', message: 'Invalid url' },
        { status: 400, statusText: 'Bad Request' },
      );

    await expect(saving).rejects.toMatchObject({ status: 400 });
    await settle();
    http.expectNone(GROUP_PAGE);
    expect(store.items().map((item) => item.id)).toEqual(['l1']);
  });

  it('replaces the card with what the API answered after pasting, without reloading', async () => {
    await openGroup({ items: [linkWith('l1'), linkWith('l2')], total: 2 });
    const completed: JobLinkSummary = {
      ...linkWith('l2'),
      previewStatus: 'enriched',
      previewVersion: 2,
      preview: { title: 'Backend Engineer', company: 'Acme' },
    };

    const pasting = store.pasteDescription('l2', { text: 'Buscamos backend…' });
    http.expectOne({ method: 'POST', url: '/api/links/l2/pasted' }).flush(completed);

    await expect(pasting).resolves.toEqual(completed);
    await settle();
    http.expectNone(GROUP_PAGE);
    expect(store.items().map((item) => item.preview?.title)).toEqual([undefined, 'Backend Engineer']);
  });

  it('undoes every field of a paste in a single request', async () => {
    await openGroup({ items: [linkWith('l1')], total: 1 });

    const undoing = store.undoPaste('l1', ['company', 'location', 'summary']);
    const request = http.expectOne({ method: 'PATCH', url: '/api/links/l1/preview' });
    expect(request.request.body).toEqual({ revert: ['company', 'location', 'summary'] });
    request.flush({ ...linkWith('l1'), previewVersion: 3 });

    await expect(undoing).resolves.toMatchObject({ previewVersion: 3 });
    expect(store.items()[0]?.previewVersion).toBe(3);
  });

  it('forgets the previous list when another one is opened', async () => {
    await openGroup({ items: [linkWith('l1')], total: 1, nextCursor: 'Y3Vyc29y' });

    const opening = store.open({ kind: 'mine' });
    expect(store.items()).toEqual([]);
    expect(store.total()).toBe(0);
    expect(store.loaded()).toBe(false);
    expect(store.hasMore()).toBe(false);
    http.expectOne(MINE_PAGE).flush({ items: [], total: 0 } satisfies LinkPage);
    await opening;

    expect(store.isEmpty()).toBe(true);
  });

  it('forgets the list when the screen is left', async () => {
    await openGroup({ items: [linkWith('l1')], total: 1 });

    store.close();

    expect(store.items()).toEqual([]);
    expect(store.loaded()).toBe(false);
    expect(store.scope()).toBeNull();
  });

  describe('when the list changes while a request is in flight', () => {
    function ids(): string[] {
      return store.items().map((item) => item.id);
    }

    it('never shows the links of the previous group while the next one loads', async () => {
      const openingA = store.open(GROUP_A);
      const openingB = store.open(GROUP_B);

      http.expectOne(GROUP_PAGE).flush({ items: [readLinkWith('a1')], total: 1 } satisfies LinkPage);
      await openingA;

      expect(store.items()).toEqual([]);
      expect(store.loaded()).toBe(false);
      expect(store.loading()).toBe(true);

      http
        .expectOne(OTHER_GROUP_PAGE)
        .flush({ items: [readLinkWith('b1'), readLinkWith('b2')], total: 2 } satisfies LinkPage);
      await openingB;

      expect(ids()).toEqual(['b1', 'b2']);
      expect(store.total()).toBe(2);
      expect(store.loading()).toBe(false);
    });

    it('keeps the open group when the previous list answers last', async () => {
      const openingA = store.open(GROUP_A);
      const openingB = store.open(GROUP_B);

      http.expectOne(OTHER_GROUP_PAGE).flush({ items: [readLinkWith('b1')], total: 1 } satisfies LinkPage);
      await openingB;
      http
        .expectOne(GROUP_PAGE)
        .flush({ items: [readLinkWith('a1'), readLinkWith('a2')], total: 2 } satisfies LinkPage);
      await expect(openingA).resolves.toBeUndefined();

      expect(ids()).toEqual(['b1']);
      expect(store.total()).toBe(1);
      expect(store.loading()).toBe(false);
    });

    it('ignores a late error of the previous group and keeps loading', async () => {
      const openingA = store.open(GROUP_A);
      const openingB = store.open(GROUP_B);

      http.expectOne(GROUP_PAGE).flush(NOT_FOUND_BODY, NOT_FOUND);
      await expect(openingA).resolves.toBeUndefined();

      expect(store.failure()).toBeNull();
      expect(store.loading()).toBe(true);

      http.expectOne(OTHER_GROUP_PAGE).flush({ items: [readLinkWith('b1')], total: 1 } satisfies LinkPage);
      await openingB;
      expect(ids()).toEqual(['b1']);
      expect(store.failure()).toBeNull();
    });

    it('shows the error of the open group and stops loading', async () => {
      const openingA = store.open(GROUP_A);
      const openingB = store.open(GROUP_B);

      http.expectOne(OTHER_GROUP_PAGE).flush(NOT_FOUND_BODY, NOT_FOUND);
      await expect(openingB).resolves.toBeUndefined();

      expect(store.failure()).toMatchObject({ kind: 'api', status: 404, code: 'group_not_found' });
      expect(store.loading()).toBe(false);

      http.expectOne(GROUP_PAGE).flush({ items: [readLinkWith('a1')], total: 1 } satisfies LinkPage);
      await openingA;
      expect(store.items()).toEqual([]);
      expect(store.failure()).not.toBeNull();
    });

    it('drops the next page of the previous group', async () => {
      await openGroup({ items: [readLinkWith('a1')], total: 2, nextCursor: 'Y3Vyc29y' });

      const more = store.loadMore();
      expect(store.loadingMore()).toBe(true);
      const openingB = store.open(GROUP_B);

      http
        .expectOne('/api/groups/g1/links?limit=20&cursor=Y3Vyc29y')
        .flush({ items: [readLinkWith('a2')], total: 2 } satisfies LinkPage);
      await expect(more).resolves.toBeUndefined();

      expect(store.items()).toEqual([]);
      expect(store.loadingMore()).toBe(false);

      http.expectOne(OTHER_GROUP_PAGE).flush({ items: [readLinkWith('b1')], total: 1 } satisfies LinkPage);
      await openingB;
      expect(ids()).toEqual(['b1']);
      expect(store.loadingMore()).toBe(false);
    });

    it('drops the next page of a stale cursor when the same list reloads on focus', async () => {
      await openGroup({ items: [readLinkWith('l1')], total: 3, nextCursor: 'Y3Vyc29y' });

      const more = store.loadMore();
      document.dispatchEvent(new Event('visibilitychange'));
      expect(store.loadingMore()).toBe(false);

      http.expectOne(GROUP_PAGE).flush({
        items: [readLinkWith('l1'), readLinkWith('l2')],
        total: 3,
        nextCursor: 'bnVldm8',
      } satisfies LinkPage);
      await settle();
      http
        .expectOne('/api/groups/g1/links?limit=20&cursor=Y3Vyc29y')
        .flush({ items: [readLinkWith('l2'), readLinkWith('l3')], total: 3 } satisfies LinkPage);
      await more;

      expect(ids()).toEqual(['l1', 'l2']);
      expect(store.nextCursor()).toBe('bnVldm8');
      expect(store.loadingMore()).toBe(false);
      expect(store.loading()).toBe(false);
    });

    it('stays empty and idle when the list is closed before it answers', async () => {
      const opening = store.open(GROUP_A);

      store.close();
      http.expectOne(GROUP_PAGE).flush({ items: [readLinkWith('a1')], total: 1 } satisfies LinkPage);
      await expect(opening).resolves.toBeUndefined();

      expect(store.items()).toEqual([]);
      expect(store.loaded()).toBe(false);
      expect(store.loading()).toBe(false);
      expect(store.scope()).toBeNull();
    });

    it('keeps the second of two reloads of the same list that answer out of order', async () => {
      await openGroup({ items: [readLinkWith('l1')], total: 1 });

      const first = store.reload();
      const second = store.reload();
      const [firstRequest, secondRequest] = http.match(GROUP_PAGE);

      secondRequest?.flush({ items: [readLinkWith('l2'), readLinkWith('l1')], total: 2 } satisfies LinkPage);
      await second;
      firstRequest?.flush({ items: [readLinkWith('l1')], total: 1 } satisfies LinkPage);
      await first;

      expect(ids()).toEqual(['l2', 'l1']);
      expect(store.total()).toBe(2);
      expect(store.loading()).toBe(false);
    });

    it('resolves a save with its response even when its reload is superseded', async () => {
      await openGroup({ items: [], total: 0 });

      const saving = store.save('https://ejemplo.test/oferta');
      http
        .expectOne({ method: 'POST', url: '/api/links' })
        .flush(
          { link: readLinkWith('l1'), created: true, shared: 'created', alreadyInGroups: [] },
          { status: 201, statusText: 'Created' },
        );
      await settle();
      const focus = store.reload();
      const [saveReload, focusReload] = http.match(GROUP_PAGE);

      focusReload?.flush({ items: [readLinkWith('l1'), readLinkWith('l0')], total: 2 } satisfies LinkPage);
      await focus;
      saveReload?.flush({ items: [readLinkWith('l1')], total: 1 } satisfies LinkPage);

      await expect(saving).resolves.toMatchObject({ created: true, shared: 'created' });
      expect(ids()).toEqual(['l1', 'l0']);
    });

    it('does not reload another group nor open the counter when an import answers there', async () => {
      await openGroup({ items: [readLinkWith('a1')], total: 1 });

      const importing = store.importText('mira esto https://ejemplo.test/oferta');
      const request = http.expectOne({ method: 'POST', url: '/api/links/import' });
      expect(request.request.body).toMatchObject({ groupId: 'g1' });

      const openingB = store.open(GROUP_B);
      http.expectOne(OTHER_GROUP_PAGE).flush({ items: [readLinkWith('b1')], total: 1 } satisfies LinkPage);
      await openingB;

      request.flush(
        { created: 1, existing: 0, unrecognized: 0, skipped: 0, links: [linkWith('n1')] },
        { status: 201, statusText: 'Created' },
      );
      await expect(importing).resolves.toMatchObject({ created: 1 });
      await settle();

      http.expectNone(OTHER_GROUP_PAGE);
      http.expectNone(GROUP_PAGE);
      expect(ids()).toEqual(['b1']);
      expect(store.reading()).toBeNull();

      // Lo importado quedó en A, que es adonde fue el `POST`: se ve al volver.
      await openGroup({ items: [linkWith('n1'), readLinkWith('a1')], total: 2 });
      expect(ids()).toEqual(['n1', 'a1']);
    });

    it('reloads and opens the counter when an import answers after coming back to its group', async () => {
      await openGroup({ items: [readLinkWith('a1')], total: 1 });

      const importing = store.importText('mira esto https://ejemplo.test/oferta');
      const request = http.expectOne({ method: 'POST', url: '/api/links/import' });

      const openingB = store.open(GROUP_B);
      // Un ámbito equivalente pero distinto objeto: `stillOn` compara por valor (design D1), así que la importación
      // sigue siendo de la lista abierta aunque se haya salido y vuelto.
      const openingA = store.open({ kind: 'group', groupId: 'g1' });
      http.expectOne(OTHER_GROUP_PAGE).flush({ items: [readLinkWith('b1')], total: 1 } satisfies LinkPage);
      http.expectOne(GROUP_PAGE).flush({ items: [readLinkWith('a1')], total: 1 } satisfies LinkPage);
      await Promise.all([openingB, openingA]);

      request.flush(
        {
          created: 2,
          existing: 0,
          unrecognized: 0,
          skipped: 0,
          links: [linkWith('n1'), linkWith('n2')],
        },
        { status: 201, statusText: 'Created' },
      );
      await flushPage(GROUP_PAGE, {
        items: [linkWith('n1'), linkWith('n2'), readLinkWith('a1')],
        total: 3,
      });

      await expect(importing).resolves.toMatchObject({ created: 2 });
      expect(ids()).toEqual(['n1', 'n2', 'a1']);
      expect(store.reading()).toEqual({ done: 0, total: 2 });
    });

    it('shows the failure and no counter when the reload after an import fails', async () => {
      await openGroup({ items: [], total: 0 });

      const importing = store.importText('mira esto https://ejemplo.test/oferta');
      http
        .expectOne({ method: 'POST', url: '/api/links/import' })
        .flush(
          { created: 1, existing: 0, unrecognized: 0, skipped: 0, links: [linkWith('n1')] },
          { status: 201, statusText: 'Created' },
        );
      await settle();
      http
        .expectOne(GROUP_PAGE)
        .flush({ code: 'internal', message: 'Boom' }, { status: 500, statusText: 'Server Error' });

      await expect(importing).resolves.toMatchObject({ created: 1 });
      expect(store.failure()).toMatchObject({ status: 500 });
      expect(store.reading()).toBeNull();
      expect(store.loading()).toBe(false);
    });

    it('does not reload another group when a save or a removal answers there', async () => {
      await openGroup({ items: [readLinkWith('a1')], total: 1 });

      const saving = store.save('https://ejemplo.test/oferta');
      const saveRequest = http.expectOne({ method: 'POST', url: '/api/links' });
      expect(saveRequest.request.body).toMatchObject({ groupId: 'g1' });
      const openingB = store.open(GROUP_B);
      http.expectOne(OTHER_GROUP_PAGE).flush({ items: [readLinkWith('b1')], total: 1 } satisfies LinkPage);
      await openingB;
      saveRequest.flush(
        { link: readLinkWith('n1'), created: true, shared: 'created', alreadyInGroups: [] },
        { status: 201, statusText: 'Created' },
      );
      await expect(saving).resolves.toMatchObject({ created: true });
      await settle();
      http.expectNone(OTHER_GROUP_PAGE);
      http.expectNone(GROUP_PAGE);

      await openGroup({ items: [readLinkWith('a1')], total: 1 });
      const removing = store.remove('a1');
      const removeRequest = http.expectOne({ method: 'DELETE', url: '/api/groups/g1/links/a1' });
      const reopeningB = store.open(GROUP_B);
      http.expectOne(OTHER_GROUP_PAGE).flush({ items: [readLinkWith('b1')], total: 1 } satisfies LinkPage);
      await reopeningB;
      removeRequest.flush(null, { status: 204, statusText: 'No Content' });
      await expect(removing).resolves.toBeUndefined();
      await settle();
      http.expectNone(OTHER_GROUP_PAGE);
      http.expectNone(GROUP_PAGE);
      expect(ids()).toEqual(['b1']);
    });

    it('keeps the card of the open group when an edit asked from another group answers', async () => {
      await openGroup({ items: [readLinkWith('l1', 'Ana')], total: 1 });

      const pasting = store.pasteDescription('l1', { text: 'Buscamos backend…' });
      const request = http.expectOne({ method: 'POST', url: '/api/links/l1/pasted' });
      const openingB = store.open(GROUP_B);
      http
        .expectOne(OTHER_GROUP_PAGE)
        .flush({ items: [readLinkWith('l1', 'Luis')], total: 1 } satisfies LinkPage);
      await openingB;

      const edited: JobLinkSummary = {
        ...readLinkWith('l1', 'Ana'),
        previewVersion: 2,
        preview: { title: 'Backend Engineer' },
      };
      request.flush(edited);

      await expect(pasting).resolves.toEqual(edited);
      expect(store.items()[0]?.sharedBy?.displayName).toBe('Luis');
      expect(store.items()[0]?.preview).toBeUndefined();
    });

    it('replaces the card of the same list even if it was reloaded meanwhile', async () => {
      await openGroup({ items: [readLinkWith('l1')], total: 1 });

      const retrying = store.retryEnrichment('l1');
      const request = http.expectOne({ method: 'POST', url: '/api/links/l1/enrich' });
      const reloading = store.reload();
      http.expectOne(GROUP_PAGE).flush({ items: [readLinkWith('l1')], total: 1 } satisfies LinkPage);
      await reloading;

      const retried: JobLinkSummary = { ...readLinkWith('l1'), previewStatus: 'pending', previewVersion: 2 };
      request.flush(retried);

      await expect(retrying).resolves.toEqual(retried);
      expect(store.items()[0]).toEqual(retried);
  describe('group comments', () => {
    it('La lectura de la oferta no borra los comentarios', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });
      const enriched: JobLinkSummary = {
        ...linkWith('l1'),
        previewStatus: 'enriched',
        previewVersion: 2,
        preview: { title: 'Backend Engineer', company: 'Acme' },
      };

      store.applyEnriched(enriched);

      const [card] = store.items();
      expect(card?.preview?.title).toBe('Backend Engineer');
      expect(card?.note?.text).toBe('Esta es la que te dije');
      expect(card?.comments?.latest.map((comment) => comment.text)).toEqual([
        'Ya cerró',
        'Piden inglés C1',
      ]);
    });

    it('Corregir el preview no borra los comentarios', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });

      const updating = store.updatePreview('l1', { fields: { title: 'Título corregido' } });
      http
        .expectOne({ method: 'PATCH', url: '/api/links/l1/preview' })
        .flush({ ...linkWith('l1'), previewVersion: 2, preview: { title: 'Título corregido' } });
      await updating;

      const [card] = store.items();
      expect(card?.preview?.title).toBe('Título corregido');
      expect(card?.note?.text).toBe('Esta es la que te dije');
      expect(card?.comments?.count).toBe(2);
    });

    it('keeps the note and the comments after pasting a description too', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });

      const pasting = store.pasteDescription('l1', { text: 'Buscamos backend…' });
      http
        .expectOne({ method: 'POST', url: '/api/links/l1/pasted' })
        .flush({ ...linkWith('l1'), previewVersion: 3 });
      await pasting;

      expect(store.items()[0]).toMatchObject({
        previewVersion: 3,
        note: { text: 'Esta es la que te dije' },
      });
      expect(store.items()[0]?.comments?.count).toBe(2);
    });

    it('Comentario que llega mientras miras', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });
      const channel = TestBed.inject(EventsChannel);
      channel.connect();
      const beto = commentWith('c3', 'Lo vi en LinkedIn');
      const message = noticeFor('l1', summaryWith(3, [beto, commentWith('c2', 'Ya cerró')], 3));

      const request = http.expectOne('/api/events');
      const body = `event: group-link.comments\ndata: ${JSON.stringify(message)}\n\n`;
      request.event({ type: HttpEventType.DownloadProgress, loaded: body.length, partialText: body });
      await settle();

      expect(store.items()[0]?.comments).toEqual(message.comments);
    });

    it('Un resumen viejo no pisa uno nuevo', async () => {
      await openGroup({ items: [linkWithContext('l1', 7)], total: 1 });
      const late = noticeFor('l1', summaryWith(6, [commentWith('c9', 'Viejo')], 5));

      store.applyCommentsChanged(late);

      expect(store.items()[0]?.comments?.revision).toBe(7);
      expect(store.items()[0]?.comments?.count).toBe(2);
    });

    it('Volver a compartir no congela la tarjeta', async () => {
      await openGroup({ items: [linkWithContext('l1', 7)], total: 1 });
      const reshared = noticeFor(
        'l1',
        summaryWith(1, [commentWith('c9', 'De nuevo aquí')], 1, '2026-09-19T12:00:00.000Z'),
      );

      store.applyCommentsChanged(reshared);

      expect(store.items()[0]?.comments).toEqual(reshared.comments);
    });

    it('ignores the notices of another group and of links that are not loaded', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });

      store.applyCommentsChanged(noticeFor('l1', summaryWith(9, [], 0), 'g2'));
      store.applyCommentsChanged(noticeFor('l2', summaryWith(9, [], 0)));

      expect(store.items()[0]?.comments?.revision).toBe(2);
      expect(store.items()).toHaveLength(1);
    });

    it('applies the summary of a posted comment unless a newer one already arrived', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });
      const mine = commentWith('c3', 'Ya cerró', 'Ana');

      const posting = store.postComment('g1', 'l1', 'Ya cerró');
      const request = http.expectOne({ method: 'POST', url: '/api/groups/g1/links/l1/comments' });
      expect(request.request.body).toEqual({ text: 'Ya cerró' });
      // El aviso de un comentario posterior llega antes que la respuesta del propio.
      const newer = summaryWith(4, [commentWith('c4', 'Otro'), mine], 4);
      store.applyCommentsChanged(noticeFor('l1', newer));
      request.flush(
        { comment: mine, comments: summaryWith(3, [mine, commentWith('c2', 'Ya cerró')], 3) },
        { status: 201, statusText: 'Created' },
      );
      await expect(posting).resolves.toMatchObject({ comment: mine });

      expect(store.items()[0]?.comments).toEqual(newer);
    });

    it('applies the summary of the 200 of a deletion', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });
      const after = summaryWith(3, [commentWith('c1', 'Piden inglés C1')], 1);

      const deleting = store.deleteComment('g1', 'l1', 'c2');
      http
        .expectOne({ method: 'DELETE', url: '/api/groups/g1/links/l1/comments/c2' })
        .flush({ comments: after });

      await expect(deleting).resolves.toEqual({ comments: after });
      expect(store.items()[0]?.comments).toEqual(after);
    });

    it('takes a comment_not_found on deletion as done', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });

      const deleting = store.deleteComment('g1', 'l1', 'c2');
      http
        .expectOne({ method: 'DELETE', url: '/api/groups/g1/links/l1/comments/c2' })
        .flush(
          { code: 'comment_not_found', message: 'Not found' },
          { status: 404, statusText: 'Not Found' },
        );

      await expect(deleting).resolves.toBeNull();
    });

    it('propagates any other deletion error', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });

      const deleting = store.deleteComment('g1', 'l1', 'c2');
      http
        .expectOne({ method: 'DELETE', url: '/api/groups/g1/links/l1/comments/c2' })
        .flush({ code: 'forbidden', message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

      await expect(deleting).rejects.toMatchObject({ status: 403 });
      expect(store.items()[0]?.comments?.count).toBe(2);
    });

    it('drops the note from the card once removed, without reloading', async () => {
      await openGroup({ items: [linkWithContext('l1')], total: 1 });

      const removing = store.removeNote('g1', 'l1');
      http
        .expectOne({ method: 'DELETE', url: '/api/groups/g1/links/l1/note' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await removing;

      await settle();
      http.expectNone(GROUP_PAGE);
      expect(store.items()[0]?.note).toBeUndefined();
      expect(store.items()[0]?.comments?.count).toBe(2);
    });
  });
});
