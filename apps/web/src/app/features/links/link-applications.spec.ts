import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import type {
  Application,
  GroupTrackersResponse,
  ImportLinksResponse,
  JobLinkSummary,
  LinkPage,
  TrackLinkResponse,
} from '@linkvault/shared';
import { applicationWith, trackerWith } from '../../../testing/applications-testing';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { ApplicationsStore } from '../../core/applications/applications.store';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore, type LinksScope } from '../../core/links/links.store';
import { LinkList } from './link-list.component';

function linkWith(id: string): JobLinkSummary {
  return {
    id,
    normalizedUrl: `https://www.linkedin.com/jobs/view/${id}`,
    displayUrl: `https://www.linkedin.com/jobs/view/${id}`,
    platform: 'linkedin',
    previewStatus: 'enriched',
    previewVersion: 2,
    preview: { title: `Oferta ${id}`, company: 'Acme' },
    sharedBy: { userId: 'u2', displayName: 'Beto' },
    sharedAt: '2026-09-17T10:00:00.000Z',
  };
}

function linksNamed(count: number, from = 1): JobLinkSummary[] {
  return Array.from({ length: count }, (_, index) => linkWith(`l${from + index}`));
}

/** La lista tal como la pintan el detalle del grupo y `/mis-links`: con los links de `LinksStore`. */
@Component({
  selector: 'lv-link-list-host',
  imports: [LinkList],
  template: `<lv-link-list [links]="store.items()" [scope]="scope()" [groupId]="groupId()" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class LinkListHost {
  readonly store = inject(LinksStore);
  readonly scope = signal<'group' | 'mine'>('group');
  readonly groupId = signal<string | null>('g1');
}

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const MINE_PAGE = '/api/links/mine?limit=20';

describe('LinkList with applications', () => {
  let fixture: ComponentFixture<LinkListHost>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(MatSnackBar).dismiss();
    verifyNoPendingRequests(http);
  });

  async function refresh(): Promise<void> {
    await settle();
    await fixture.whenStable();
  }

  async function open(scope: LinksScope, links: JobLinkSummary[]): Promise<void> {
    fixture = TestBed.createComponent(LinkListHost);
    fixture.componentInstance.scope.set(scope.kind);
    fixture.componentInstance.groupId.set(scope.kind === 'group' ? scope.groupId : null);
    const opening = fixture.componentInstance.store.open(scope);
    http
      .expectOne(scope.kind === 'group' ? GROUP_PAGE : MINE_PAGE)
      .flush({ items: links, total: links.length } satisfies LinkPage);
    await opening;
    await refresh();
  }

  function ownRequest(linkIds: string[]): TestRequest {
    return http.expectOne(`/api/applications?linkIds=${linkIds.join(',')}`);
  }

  function sharedRequest(linkIds: string[]): TestRequest {
    return http.expectOne(`/api/groups/g1/applications?linkIds=${linkIds.join(',')}`);
  }

  /** Abre el grupo con esos links y responde a los estados propios y compartidos de la página. */
  async function openGroup(
    links: JobLinkSummary[],
    own: Application[] = [],
    shared: GroupTrackersResponse['items'] = links.map((link) => ({ linkId: link.id, trackers: [] })),
  ): Promise<void> {
    await open({ kind: 'group', groupId: 'g1' }, links);
    const ids = links.map((link) => link.id);
    ownRequest(ids).flush({ items: own });
    sharedRequest(ids).flush({ items: shared });
    await refresh();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function card(title: string): HTMLElement {
    const element = Array.from(host().querySelectorAll<HTMLElement>('lv-link-card')).find((item) =>
      item.textContent?.includes(title),
    );
    if (!element) {
      throw new Error(`Card "${title}" not rendered`);
    }
    return element;
  }

  function text(element: Element | null): string {
    return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function part(title: string, testId: string): HTMLElement | null {
    return card(title).querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  function notice(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('lv-share-notice');
  }

  async function click(element: HTMLElement | null): Promise<void> {
    if (!element) {
      throw new Error('Nothing to click');
    }
    element.click();
    await refresh();
  }

  async function trackRequest(): Promise<TestRequest> {
    return await vi.waitFor(() => http.expectOne({ method: 'POST', url: '/api/applications' }));
  }

  async function updateRequest(id = 'a-l1'): Promise<TestRequest> {
    return await vi.waitFor(() => http.expectOne({ method: 'PATCH', url: `/api/applications/${id}` }));
  }

  describe('gestures', () => {
    it('offers "Me interesa" and "Postulé" on an offer that is not tracked', async () => {
      await openGroup([linkWith('l1')]);

      expect(text(part('Oferta l1', 'link-interested'))).toBe('Me interesa');
      expect(text(part('Oferta l1', 'link-applied'))).toBe('Postulé');
      expect(part('Oferta l1', 'link-own-status')).toBeNull();
    });

    it('Postulé desde el grupo', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-applied'));
      buttonWithText(dialog(), 'Hoy').click();
      const request = await trackRequest();
      expect(request.request.body).toEqual({ linkId: 'l1', status: 'applied' });
      request.flush({
        application: applicationWith({ status: 'applied', appliedAt: new Date().toISOString() }),
        created: true,
      } satisfies TrackLinkResponse);
      await refresh();

      expect(text(part('Oferta l1', 'link-own-status'))).toBe('Tu postulación: Postulada');
      expect(part('Oferta l1', 'link-own-status-link')?.getAttribute('href')).toBe('/postulaciones');
      expect(part('Oferta l1', 'link-interested')).toBeNull();
      expect(part('Oferta l1', 'link-applied')).toBeNull();
    });

    it('cancels "Postulé" when the date question is cancelled', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-applied'));
      buttonWithText(dialog(), 'Cancelar').click();
      await vi.waitFor(() => expect(document.body.querySelector('mat-dialog-container')).toBeNull());
      await refresh();

      http.expectNone({ method: 'POST', url: '/api/applications' });
      expect(part('Oferta l1', 'link-applied')).not.toBeNull();
    });

    it('De «Interés» a «Postulé»', async () => {
      await openGroup([linkWith('l1')], [applicationWith({ status: 'interested', version: 2 })]);

      expect(text(part('Oferta l1', 'link-own-status'))).toBe('Tu postulación: Interés');
      expect(part('Oferta l1', 'link-interested')).toBeNull();
      await click(part('Oferta l1', 'link-applied'));
      buttonWithText(dialog(), 'Hoy').click();
      const request = await vi.waitFor(() =>
        http.expectOne({ method: 'PATCH', url: '/api/applications/a-l1/status' }),
      );
      expect(request.request.body).toEqual({ status: 'applied', version: 2 });
      request.flush(applicationWith({ status: 'applied', appliedAt: new Date().toISOString(), version: 3 }));
      await refresh();

      expect(text(part('Oferta l1', 'link-own-status'))).toBe('Tu postulación: Postulada');
      expect(part('Oferta l1', 'link-applied')).toBeNull();
    });

    it('Ya la seguía en otra pestaña', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-interested'));
      (await trackRequest()).flush({
        application: applicationWith({ status: 'in_process', appliedAt: '2026-09-10T10:00:00.000Z' }),
        created: false,
      } satisfies TrackLinkResponse);
      await refresh();

      expect(text(part('Oferta l1', 'link-own-status'))).toBe('Tu postulación: En proceso');
      expect(text(part('Oferta l1', 'link-already-tracked'))).toBe('Ya la seguías');
    });

    it('offers the gestures again once the application is untracked', async () => {
      await openGroup([linkWith('l1')], [applicationWith()]);

      const { body, options } = apiError('application_not_found', 404);
      await click(part('Oferta l1', 'link-applied'));
      buttonWithText(dialog(), 'Hoy').click();
      (
        await vi.waitFor(() => http.expectOne({ method: 'PATCH', url: '/api/applications/a-l1/status' }))
      ).flush(body, options);
      await refresh();

      expect(part('Oferta l1', 'link-interested')).not.toBeNull();
      expect(host().querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('requests by block', () => {
    it('Una petición por página', async () => {
      const links = linksNamed(20);
      await open({ kind: 'group', groupId: 'g1' }, links);

      const own = http.match((request) => request.url === '/api/applications');
      const shared = http.match((request) => request.url === '/api/groups/g1/applications');
      expect(own).toHaveLength(1);
      expect(shared).toHaveLength(1);
      expect(own[0].request.params.get('linkIds')?.split(',')).toHaveLength(20);
      own[0].flush({ items: [] });
      shared[0].flush({ items: [] });
    });

    it('asks only for the own state in "Solo para mí"', async () => {
      await open({ kind: 'mine' }, linksNamed(3));

      ownRequest(['l1', 'l2', 'l3']).flush({ items: [] });
      http.expectNone((request) => request.url.startsWith('/api/groups/'));
    });

    it('Links recién guardados', async () => {
      await openGroup(linksNamed(4, 4));

      const importing = fixture.componentInstance.store.importText('chat con tres ofertas');
      http.expectOne({ method: 'POST', url: '/api/links/import' }).flush({
        created: 3,
        existing: 0,
        unrecognized: 0,
        skipped: 0,
        links: linksNamed(3),
      } satisfies ImportLinksResponse);
      await settle();
      http
        .expectOne(GROUP_PAGE)
        .flush({ items: [...linksNamed(3), ...linksNamed(4, 4)], total: 7 } satisfies LinkPage);
      await importing;
      await refresh();

      ownRequest(['l1', 'l2', 'l3']).flush({ items: [] });
      sharedRequest(['l1', 'l2', 'l3']).flush({ items: [] });
    });

    it('asks for the next page when more links are loaded', async () => {
      fixture = TestBed.createComponent(LinkListHost);
      const store = fixture.componentInstance.store;
      const opening = store.open({ kind: 'group', groupId: 'g1' });
      http
        .expectOne(GROUP_PAGE)
        .flush({ items: linksNamed(2), total: 4, nextCursor: 'c2' } satisfies LinkPage);
      await opening;
      await refresh();
      ownRequest(['l1', 'l2']).flush({ items: [] });
      sharedRequest(['l1', 'l2']).flush({ items: [] });

      const loading = store.loadMore();
      http
        .expectOne('/api/groups/g1/links?limit=20&cursor=c2')
        .flush({ items: linksNamed(2, 3), total: 4 } satisfies LinkPage);
      await loading;
      await refresh();

      ownRequest(['l3', 'l4']).flush({ items: [] });
      sharedRequest(['l3', 'l4']).flush({ items: [] });
    });
  });

  describe('share invitation', () => {
    it('Compartir tras el gesto', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-interested'));
      (await trackRequest()).flush({ application: applicationWith(), created: true });
      await refresh();

      expect(text(notice())).toContain(
        '¿Que tus grupos vean que te interesa esta oferta? También quien entre después.',
      );
      expect(text(notice())).toContain('Compartir');
      expect(text(notice())).toContain('Qué verán');

      await click(notice()?.querySelector<HTMLElement>('[data-testid="share-notice-share"]') ?? null);
      const request = await updateRequest();
      expect(request.request.body).toEqual({ visibility: 'group' });
      request.flush(applicationWith({ visibility: 'group' }));
      await vi.waitFor(() => expect(text(notice())).toContain('Compartido'));

      expect(text(notice())).toContain('Deshacer');
      expect(card('Oferta l1').querySelector('[data-testid="tracker-avatar"]')?.getAttribute('aria-label')).toBe(
        'Ana · postulación: Interés',
      );
    });

    it('shows what the groups will see', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-interested'));
      (await trackRequest()).flush({ application: applicationWith(), created: true });
      await refresh();
      await click(notice()?.querySelector<HTMLElement>('[data-testid="share-notice-scope"]') ?? null);

      expect(text(dialog().querySelector('[data-testid="share-scope-text"]'))).toBe(
        'Te verán los miembros de tus grupos donde esté esta oferta, ahora o más adelante, incluidos quienes se unan después. Verán tu nombre y tu estado, también cuando cambie (por ejemplo, «Rechazada»). Nunca la etapa, las notas ni el historial. Puedes dejar de compartir cuando quieras.',
      );
      expect(notice()).not.toBeNull();
    });

    it('Texto tras «Postulé»', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-applied'));
      buttonWithText(dialog(), 'Hoy').click();
      (await trackRequest()).flush({ application: applicationWith({ status: 'applied' }), created: true });
      await vi.waitFor(() => expect(notice()).not.toBeNull());

      expect(text(notice())).toContain(
        '¿Que tus grupos vean que postulaste a esta oferta? También quien entre después.',
      );
    });

    it('Sin pulsar, sigue privada', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-applied'));
      buttonWithText(dialog(), 'Hoy').click();
      (await trackRequest()).flush({ application: applicationWith({ status: 'applied' }), created: true });
      await vi.waitFor(() => expect(notice()).not.toBeNull());
      TestBed.inject(MatSnackBar).dismiss();
      await vi.waitFor(() => expect(notice()).toBeNull());
      await refresh();

      http.expectNone({ method: 'PATCH', url: '/api/applications/a-l1' });
      expect(card('Oferta l1').querySelector('[data-testid="tracker-avatar"]')).toBeNull();
    });

    it('En Mis links no se ofrece', async () => {
      await open({ kind: 'mine' }, [linkWith('l1')]);
      ownRequest(['l1']).flush({ items: [] });
      await refresh();

      await click(part('Oferta l1', 'link-interested'));
      (await trackRequest()).flush({ application: applicationWith(), created: true });
      await refresh();

      expect(notice()).toBeNull();
    });

    it('Ya estaba compartida', async () => {
      await openGroup([linkWith('l1')], [applicationWith({ status: 'interested', visibility: 'group' })]);

      await click(part('Oferta l1', 'link-applied'));
      buttonWithText(dialog(), 'Hoy').click();
      (
        await vi.waitFor(() => http.expectOne({ method: 'PATCH', url: '/api/applications/a-l1/status' }))
      ).flush(applicationWith({ status: 'applied', visibility: 'group', version: 2 }));
      await refresh();

      expect(notice()).toBeNull();
    });

    it('Deshacer compartir', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-interested'));
      (await trackRequest()).flush({ application: applicationWith(), created: true });
      await refresh();
      await click(notice()?.querySelector<HTMLElement>('[data-testid="share-notice-share"]') ?? null);
      (await updateRequest()).flush(applicationWith({ visibility: 'group' }));
      await vi.waitFor(() =>
        expect(notice()?.querySelector('[data-testid="share-notice-undo"]')).not.toBeNull(),
      );
      await refresh();
      expect(card('Oferta l1').querySelector('[data-testid="tracker-avatar"]')).not.toBeNull();

      await click(notice()?.querySelector<HTMLElement>('[data-testid="share-notice-undo"]') ?? null);
      const undo = await updateRequest();
      expect(undo.request.body).toEqual({ visibility: 'private' });
      undo.flush(applicationWith({ visibility: 'private' }));
      await refresh();

      expect(card('Oferta l1').querySelector('[data-testid="tracker-avatar"]')).toBeNull();
      http.expectNone((request) => request.url.startsWith('/api/groups/g1/applications'));
    });

    it('acts on the application captured by the gesture', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-interested'));
      (await trackRequest()).flush({ application: applicationWith({ id: 'a-first' }), created: true });
      await refresh();
      // Mientras el aviso sigue a la vista, el store pasa a tener otra postulación para ese link (otra pestaña la dejó
      // de seguir y la volvió a seguir): "Compartir" sigue actuando sobre la del gesto.
      const loading = TestBed.inject(ApplicationsStore).loadOwn(['l1']);
      ownRequest(['l1']).flush({ items: [applicationWith({ id: 'a-second' })] });
      await loading;
      await click(notice()?.querySelector<HTMLElement>('[data-testid="share-notice-share"]') ?? null);

      (await updateRequest('a-first')).flush(applicationWith({ id: 'a-first', visibility: 'group' }));
      await refresh();
      http.expectNone({ method: 'PATCH', url: '/api/applications/a-second' });
    });

    it('Se dejó de seguir entretanto', async () => {
      await openGroup([linkWith('l1')]);

      await click(part('Oferta l1', 'link-interested'));
      (await trackRequest()).flush({ application: applicationWith(), created: true });
      await refresh();
      await click(notice()?.querySelector<HTMLElement>('[data-testid="share-notice-share"]') ?? null);
      const { body, options } = apiError('application_not_found', 404);
      (await updateRequest()).flush(body, options);
      await vi.waitFor(() => expect(notice()).toBeNull());
      await refresh();

      expect(part('Oferta l1', 'link-interested')).not.toBeNull();
      expect(part('Oferta l1', 'link-applied')).not.toBeNull();
      expect(document.body.querySelector('simple-snack-bar')).toBeNull();
      expect(host().querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('avatars', () => {
    it('Avatares en la tarjeta', async () => {
      await openGroup(
        [linkWith('l1')],
        [],
        [
          {
            linkId: 'l1',
            trackers: [
              trackerWith({ userId: 'u3', displayName: 'Ana María', status: 'in_process' }),
              trackerWith({ userId: 'u2', displayName: 'Beto', status: 'applied' }),
            ],
          },
        ],
      );

      const avatars = Array.from(card('Oferta l1').querySelectorAll('[data-testid="tracker-avatar"]'));
      expect(avatars.map((avatar) => avatar.getAttribute('aria-label'))).toEqual([
        'Ana María · postulación: En proceso',
        'Beto · postulación: Postulada',
      ]);
      expect(avatars.map((avatar) => text(avatar))).toEqual(['AM', 'B']);
      const [ana, beto] = avatars as HTMLElement[];
      expect(ana.style.backgroundColor).not.toBe('');
      expect(ana.style.backgroundColor).not.toBe(beto.style.backgroundColor);
    });

    it('Estado ajeno en tercera persona', async () => {
      await openGroup([linkWith('l1')], [], [{ linkId: 'l1', trackers: [trackerWith()] }]);

      expect(
        card('Oferta l1').querySelector('[data-testid="tracker-avatar"]')?.getAttribute('aria-label'),
      ).toBe('Beto · postulación: Postulada');
    });

    it('Más de cinco', async () => {
      const seven = Array.from({ length: 7 }, (_, index) =>
        trackerWith({ userId: `u${index + 10}`, displayName: `Persona ${index + 1}` }),
      );
      await openGroup([linkWith('l1')], [], [{ linkId: 'l1', trackers: seven }]);

      expect(card('Oferta l1').querySelectorAll('[data-testid="tracker-avatar"]')).toHaveLength(5);
      expect(text(part('Oferta l1', 'tracker-more'))).toBe('+2');
    });

    it('shows no avatars in "Solo para mí"', async () => {
      await open({ kind: 'mine' }, [linkWith('l1')]);
      ownRequest(['l1']).flush({ items: [applicationWith({ visibility: 'group' })] });
      await refresh();

      expect(card('Oferta l1').querySelector('[data-testid="tracker-avatars"]')).toBeNull();
    });

    it('Volver a la pestaña', async () => {
      const links = linksNamed(120);
      await open({ kind: 'group', groupId: 'g1' }, links);
      for (const request of http.match(() => true)) {
        request.flush({ items: [] });
      }
      await refresh();

      document.dispatchEvent(new Event('visibilitychange'));
      // `LinksStore` también vuelve a pedir su primera página al recuperar el foco.
      http.expectOne(GROUP_PAGE).flush({ items: links.slice(0, 20), total: 120 } satisfies LinkPage);
      const shared = http.match((request) => request.url === '/api/groups/g1/applications');

      expect(shared.map((request) => request.request.params.get('linkIds')?.split(',').length)).toEqual([
        50, 50, 20,
      ]);
      shared[0].flush({
        items: [{ linkId: 'l1', trackers: [trackerWith({ userId: 'u3', displayName: 'Ana', status: 'applied' })] }],
      });
      shared[1].flush({ items: [] });
      shared[2].flush({ items: [] });
      await refresh();

      expect(
        card('Oferta l1').querySelector('[data-testid="tracker-avatar"]')?.getAttribute('aria-label'),
      ).toBe('Ana · postulación: Postulada');
      http.expectNone((request) => request.url === '/api/applications');
    });
  });
});
