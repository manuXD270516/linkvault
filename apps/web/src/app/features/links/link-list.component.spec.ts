import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { LinkList, type LinkListScope, linkLabel } from './link-list.component';

const linkedin: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl:
    'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=share',
  platform: 'linkedin',
  previewStatus: 'pending',
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const computrabajo: JobLinkSummary = {
  id: 'l2',
  normalizedUrl: 'https://co.computrabajo.com/trabajo/1A2B3C',
  displayUrl: 'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
  platform: 'computrabajo',
  previewStatus: 'pending',
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-17T09:00:00.000Z',
};

/** Link de la lista privada: sin grupo no hay con quién compartir, así que no trae `sharedBy`. */
const priv: JobLinkSummary = {
  id: 'l3',
  normalizedUrl: 'https://ejemplo.test/ofertas/analista',
  displayUrl: 'https://ejemplo.test/ofertas/analista',
  platform: 'generic',
  previewStatus: 'pending',
  sharedAt: '2026-09-17T08:00:00.000Z',
};

describe('LinkList', () => {
  let fixture: ComponentFixture<LinkList>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    fixture = TestBed.createComponent(LinkList);
  });

  async function render(links: JobLinkSummary[], scope: LinkListScope = 'group'): Promise<void> {
    fixture.componentRef.setInput('links', links);
    fixture.componentRef.setInput('scope', scope);
    await fixture.whenStable();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function anchors(): HTMLAnchorElement[] {
    return Array.from(host().querySelectorAll<HTMLAnchorElement>('[data-testid="link-open"]'));
  }

  it('Grupo con links', async () => {
    await render([linkedin, computrabajo]);

    expect(anchors()).toHaveLength(2);
    expect(text()).toContain('senior backend engineer at acme 3912345678');
    expect(text()).toContain('trabajo de analista de datos en acme 1A2B3C');
    expect(text()).toContain('LinkedIn');
    expect(text()).toContain('Computrabajo');
    expect(text()).toContain('Compartido por Ana');
    expect(text()).toContain('Compartido por Beto');
    expect(text()).toContain('Sin vista previa todavía');
    expect(host().querySelector('[data-testid="links-empty"]')).toBeNull();
  });

  it('Grupo sin links', async () => {
    await render([]);

    expect(text()).toBe(
      'Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís.',
    );
    expect(host().querySelector('[data-testid="link-list"]')).toBeNull();
  });

  it('Abrir una oferta', async () => {
    await render([linkedin]);

    const [anchor] = anchors();
    expect(anchor.getAttribute('href')).toBe(linkedin.displayUrl);
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('Vista privada vacía', async () => {
    await render([], 'mine');

    expect(text()).toBe(
      'Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos.',
    );
  });

  it('shows a private link without saying who shared it', async () => {
    await render([priv], 'mine');

    expect(text()).toContain('analista');
    expect(text()).toContain('Otra web');
    expect(text()).toContain('Sin vista previa todavía');
    expect(text()).not.toContain('Compartido por');
  });

  it('hides the pending notice once the preview exists', async () => {
    await render([{ ...linkedin, previewStatus: 'enriched' }]);

    expect(text()).not.toContain('Sin vista previa todavía');
  });
});

/** El detalle del grupo y `/mis-links` componen así la lista: los links salen del store, que recarga al quitar. */
@Component({
  selector: 'lv-link-list-remove-host',
  imports: [LinkList],
  template: `<lv-link-list [links]="items()" [scope]="scope()" [canModerate]="canModerate()" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RemoveHost {
  readonly items = inject(LinksStore).items;
  readonly scope = signal<LinkListScope>('group');
  readonly canModerate = signal(false);
}

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const MINE_PAGE = '/api/links/mine?limit=20';

/** Compartido por Ana, que es quien mira (`testUser` es `u1`). */
const ofAna: JobLinkSummary = { ...linkedin, id: 'l1' };
/** Compartido por Beto, otro miembro del grupo. */
const ofBeto: JobLinkSummary = {
  ...computrabajo,
  id: 'l2',
  sharedBy: { userId: 'u2', displayName: 'Beto' },
};

describe('LinkList al quitar', () => {
  let fixture: ComponentFixture<RemoveHost>;
  let http: HttpTestingController;
  let store: LinksStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    store = TestBed.inject(LinksStore);

    const opening = store.open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: [ofAna, ofBeto], total: 2 } satisfies LinkPage);
    await opening;

    fixture = TestBed.createComponent(RemoveHost);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function removeButtons(): HTMLButtonElement[] {
    return Array.from(host().querySelectorAll<HTMLButtonElement>('[data-testid="link-remove"]'));
  }

  /** Botón de quitar de la fila cuya etiqueta contiene `label`; `null` si esa fila no lo ofrece. */
  function removeButtonFor(label: string): HTMLButtonElement | null {
    const row = Array.from(host().querySelectorAll('li')).find((item) =>
      item.textContent?.includes(label),
    );
    if (!row) {
      throw new Error(`Row "${label}" not rendered`);
    }
    return row.querySelector<HTMLButtonElement>('[data-testid="link-remove"]');
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  /** Pulsa quitar en esa fila y espera a que aparezca la confirmación. */
  async function clickRemove(label: string): Promise<void> {
    const button = removeButtonFor(label);
    if (!button) {
      throw new Error(`Row "${label}" does not offer to remove`);
    }
    button.click();
    await settle();
    await fixture.whenStable();
  }

  async function confirm(): Promise<void> {
    buttonWithText(dialog(), 'Quitar').click();
    await settle();
  }

  /** El borrado arranca al cerrarse la confirmación, es decir tras su animación de cierre. */
  async function awaitRequest(method: string, url: string): Promise<TestRequest> {
    return await vi.waitFor(() => http.expectOne({ method, url }));
  }

  it('Quitar un enlace que no era una oferta', async () => {
    await clickRemove('senior backend engineer');

    expect(dialog().textContent).toContain(
      'Se quita de este grupo; la oferta sigue disponible en otros grupos.',
    );
    await confirm();

    (await awaitRequest('DELETE', '/api/groups/g1/links/l1')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();
    http.expectOne(GROUP_PAGE).flush({ items: [ofBeto], total: 1 } satisfies LinkPage);
    await settle();
    await fixture.whenStable();

    expect(host().textContent).not.toContain('senior backend engineer');
    expect(host().textContent).toContain('analista de datos');
  });

  it('Sin permiso para quitar', async () => {
    expect(removeButtons()).toHaveLength(1);
    expect(removeButtonFor('analista de datos')).toBeNull();
    expect(removeButtonFor('senior backend engineer')).not.toBeNull();
  });

  it('lets the owner remove what someone else shared', async () => {
    fixture.componentInstance.canModerate.set(true);
    await fixture.whenStable();

    expect(removeButtons()).toHaveLength(2);

    await clickRemove('analista de datos');
    await confirm();

    (await awaitRequest('DELETE', '/api/groups/g1/links/l2')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();
    http.expectOne(GROUP_PAGE).flush({ items: [ofAna], total: 1 } satisfies LinkPage);
    await settle();
    await fixture.whenStable();

    expect(host().textContent).not.toContain('analista de datos');
  });

  it('removes any link of the private list', async () => {
    const opening = store.open({ kind: 'mine' });
    http.expectOne(MINE_PAGE).flush({ items: [priv], total: 1 } satisfies LinkPage);
    await opening;
    fixture.componentInstance.scope.set('mine');
    await fixture.whenStable();

    expect(removeButtons()).toHaveLength(1);

    await clickRemove('analista');
    expect(dialog().textContent).toContain(
      'Se quita de tu lista; la oferta sigue disponible en tus grupos.',
    );
    await confirm();

    (await awaitRequest('DELETE', '/api/links/mine/l3')).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();
    http.expectOne(MINE_PAGE).flush({ items: [], total: 0 } satisfies LinkPage);
    await settle();
    await fixture.whenStable();

    expect(host().textContent).toContain(
      'Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos.',
    );
  });

  it('keeps the link when the confirmation is cancelled', async () => {
    await clickRemove('senior backend engineer');
    buttonWithText(dialog(), 'Cancelar').click();
    await settle();
    await fixture.whenStable();

    http.expectNone({ method: 'DELETE', url: '/api/groups/g1/links/l1' });
    expect(host().textContent).toContain('senior backend engineer');
  });
});

describe('linkLabel', () => {
  it.each([
    [
      'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=share',
      'senior backend engineer at acme 3912345678',
    ],
    [
      'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
      'trabajo de analista de datos en acme 1A2B3C',
    ],
    ['https://ejemplo.test/ofertas/analista.html', 'analista'],
    ['https://ejemplo.test/ofertas/desarrollador%20senior', 'desarrollador senior'],
    ['https://ejemplo.test/ofertas/analista/', 'analista'],
    ['https://www.getonboard.com/', 'getonboard.com'],
    ['https://ejemplo.test', 'ejemplo.test'],
    ['no-es-una-url', 'no-es-una-url'],
  ])('derives the label of %s', (url, expected) => {
    expect(linkLabel(url)).toBe(expected);
  });
});
