import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
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

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
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
});
