import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage, PublicShare } from '@linkvault/shared';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { LinkList } from './link-list.component';

/** El detalle del grupo compone así la lista: los links salen del store, abierto en el grupo `g1`. */
@Component({
  selector: 'lv-link-list-public-host',
  imports: [LinkList],
  template: `<lv-link-list
    [links]="items()"
    scope="group"
    groupId="g1"
    [canModerate]="canModerate()"
  />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class GroupHost {
  readonly items = inject(LinksStore).items;
  readonly canModerate = signal(false);
}

const GROUP_PAGE = '/api/groups/g1/links?limit=20';

const share: PublicShare = {
  slug: 'k3m9qrtv2xyz',
  url: 'http://localhost:3000/p/k3m9qrtv2xyz',
  publishedAt: '2026-09-19T10:00:00.000Z',
};

/** Compartido por Ana (`testUser`, `u1`), con su oferta ya leída. */
const ofAna: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/senior-backend-engineer-3912345678/',
  platform: 'linkedin',
  previewStatus: 'enriched',
  previewVersion: 1,
  preview: { title: 'Ingeniera de datos', company: 'Acme' },
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

/** Compartido por Beto, cuya lectura aún no terminó. */
const ofBeto: JobLinkSummary = {
  id: 'l2',
  normalizedUrl: 'https://co.computrabajo.com/trabajo/1A2B3C',
  displayUrl: 'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
  platform: 'computrabajo',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-17T09:00:00.000Z',
};

describe('LinkList: el enlace público', () => {
  let fixture: ComponentFixture<GroupHost>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function setUp(links: JobLinkSummary[] = [ofAna, ofBeto]): Promise<void> {
    TestBed.inject(SessionStore).setSession(sessionWith('token-1', testUser));
    const store = TestBed.inject(LinksStore);
    const opening = store.open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: links, total: links.length } satisfies LinkPage);
    await opening;
    fixture = TestBed.createComponent(GroupHost);
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function rowOf(label: string): HTMLElement {
    const row = Array.from(host().querySelectorAll<HTMLElement>('li')).find((item) =>
      item.textContent?.includes(label),
    );
    if (!row) {
      throw new Error(`Row "${label}" not rendered`);
    }
    return row;
  }

  function action(label: string, testId: string): HTMLButtonElement | null {
    return rowOf(label).querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  }

  async function click(label: string, testId: string): Promise<void> {
    const button = action(label, testId);
    if (!button) {
      throw new Error(`Row "${label}" does not offer "${testId}"`);
    }
    button.click();
    await settle();
    await fixture.whenStable();
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  async function confirm(label: string): Promise<void> {
    buttonWithText(dialog(), label).click();
    await settle();
    await fixture.whenStable();
  }

  async function awaitRequest(method: string, url: string): Promise<TestRequest> {
    return await vi.waitFor(() => http.expectOne({ method, url }));
  }

  function snackBarText(): string {
    return (
      document.body.querySelector('mat-snack-bar-container')?.textContent?.replace(/\s+/g, ' ').trim() ??
      ''
    );
  }

  /** Portapapeles falso; jsdom no trae uno. */
  function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)): typeof writeText {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  it('Compartir con un enlace público', async () => {
    await setUp();

    await click('Ingeniera de datos', 'link-public-on');
    expect(dialog().textContent).toContain(
      'Cualquiera con este enlace podrá ver la oferta sin entrar en LinkVault. No se verá el grupo, ni tu nombre, ni los comentarios. Puedes dejar de compartirlo cuando quieras.',
    );
    await confirm('Compartir');

    (await awaitRequest('PUT', '/api/groups/g1/links/l1/public')).flush(share);
    await settle();
    await fixture.whenStable();

    expect(rowOf('Ingeniera de datos').textContent).toContain('Enlace público');
    expect(action('Ingeniera de datos', 'link-public-copy')).not.toBeNull();
    // Sin recargar la lista: la tarjeta la actualizó la respuesta.
    http.expectNone(GROUP_PAGE);
  });

  it('El aviso dice el alcance', async () => {
    await setUp();

    await click('Ingeniera de datos', 'link-public-on');

    const message = dialog().textContent ?? '';
    expect(message).toContain('Cualquiera con este enlace podrá ver la oferta');
    expect(message).toContain('No se verá el grupo, ni tu nombre, ni los comentarios');
    await confirm('Cancelar');
  });

  it('Cancelar', async () => {
    await setUp();

    await click('Ingeniera de datos', 'link-public-on');
    await confirm('Cancelar');

    http.expectNone({ method: 'PUT', url: '/api/groups/g1/links/l1/public' });
    expect(rowOf('Ingeniera de datos').textContent).not.toContain('Enlace público');
  });

  it('Dejar de compartir', async () => {
    await setUp([{ ...ofAna, publicShare: share }]);

    await click('Ingeniera de datos', 'link-public-off');
    expect(dialog().textContent).toContain(
      'El enlace dejará de funcionar para todo el mundo, también para quien ya lo tenga. Si vuelves a activarlo, se creará un enlace nuevo. Las vistas previas ya enviadas en un chat pueden seguir viéndose ahí.',
    );
    await confirm('Dejar de compartir');

    (await awaitRequest('DELETE', '/api/groups/g1/links/l1/public')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();
    await fixture.whenStable();

    expect(rowOf('Ingeniera de datos').textContent).not.toContain('Enlace público');
  });

  it('La tarjeta se apaga sin recargar', async () => {
    await setUp([{ ...ofAna, publicShare: share }]);

    await click('Ingeniera de datos', 'link-public-off');
    await confirm('Dejar de compartir');
    (await awaitRequest('DELETE', '/api/groups/g1/links/l1/public')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();
    await fixture.whenStable();

    expect(action('Ingeniera de datos', 'link-public-copy')).toBeNull();
    http.expectNone(GROUP_PAGE);
  });

  it('Copiar el enlace', async () => {
    const writeText = stubClipboard();
    await setUp([{ ...ofAna, publicShare: share }]);

    await click('Ingeniera de datos', 'link-public-copy');

    expect(writeText).toHaveBeenCalledWith(share.url);
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('/p/');
    expect(copied).toContain(share.slug);
    expect(copied.startsWith('http')).toBe(true);
    expect(snackBarText()).toContain('Enlace copiado');
  });

  it('Copiar el enlace de una oferta sin leer', async () => {
    const writeText = stubClipboard();
    // Beto compartió el link, pero Ana es propietaria del grupo, así que puede tocar su interruptor.
    await setUp([{ ...ofBeto, publicShare: share }]);
    fixture.componentInstance.canModerate.set(true);
    await fixture.whenStable();

    await click('analista de datos', 'link-public-copy');

    expect(snackBarText()).toContain(
      'Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos',
    );
    expect(writeText).toHaveBeenCalledWith(share.url);
  });

  it('Sin permiso para cambiarlo', async () => {
    await setUp([{ ...ofAna, publicShare: share }]);

    await click('Ingeniera de datos', 'link-public-off');
    await confirm('Dejar de compartir');
    const { body, options } = apiError('forbidden', 403);
    (await awaitRequest('DELETE', '/api/groups/g1/links/l1/public')).flush(body, options);
    await settle();
    await fixture.whenStable();

    expect(host().textContent).toContain(
      'Solo quien compartió la oferta o el propietario del grupo puede cambiar esto',
    );
    expect(rowOf('Ingeniera de datos').textContent).toContain('Enlace público');
    http.expectNone(GROUP_PAGE);
  });

  it('reloads the list when the job is no longer in the group', async () => {
    await setUp([{ ...ofAna, publicShare: share }]);

    await click('Ingeniera de datos', 'link-public-off');
    await confirm('Dejar de compartir');
    const { body, options } = apiError('link_not_found', 404);
    (await awaitRequest('DELETE', '/api/groups/g1/links/l1/public')).flush(body, options);
    await settle();

    (await vi.waitFor(() => http.expectOne(GROUP_PAGE))).flush({ items: [], total: 0 } satisfies LinkPage);
    await settle();
    await fixture.whenStable();
  });

  it('never offers the switch to a member who neither shared the job nor owns the group', async () => {
    await setUp([{ ...ofBeto, publicShare: share }]);

    expect(rowOf('analista de datos').textContent).toContain('Enlace público');
    expect(action('analista de datos', 'link-public-off')).toBeNull();
    expect(action('analista de datos', 'link-public-copy')).toBeNull();
  });

  it('says something went wrong when the clipboard refuses', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await setUp([{ ...ofAna, publicShare: share }]);

    await click('Ingeniera de datos', 'link-public-copy');

    expect(host().textContent).toContain('Algo salió mal. Inténtalo de nuevo');
  });
});
