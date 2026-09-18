import { HttpTestingController } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import type { ImportLinksResponse, JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { ImportLinksDialog } from './import-links.dialog';
import { LinkList } from './link-list.component';

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const CHAT = 'mirad esto https://ejemplo.test/ofertas/analista y esto https://ejemplo.test/ofertas/backend';

function linkWith(id: string, slug: string): JobLinkSummary {
  return {
    id,
    normalizedUrl: `https://ejemplo.test/ofertas/${slug}`,
    displayUrl: `https://ejemplo.test/ofertas/${slug}`,
    platform: 'generic',
    previewStatus: 'pending',
    sharedBy: { userId: 'u1', displayName: 'Ana' },
    sharedAt: '2026-09-17T10:00:00.000Z',
  };
}

const analista = linkWith('l1', 'analista');
const backend = linkWith('l2', 'backend');

const empty: ImportLinksResponse = {
  created: 0,
  existing: 0,
  unrecognized: 0,
  skipped: 0,
  links: [],
};

/** El detalle del grupo compone así el diálogo y la lista: al importar, el store recarga y la lista se repinta sola. */
@Component({
  selector: 'lv-import-links-host',
  imports: [LinkList],
  template: `<lv-link-list [links]="items()" scope="group" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ImportLinksHost {
  readonly items = inject(LinksStore).items;
}

describe('ImportLinksDialog', () => {
  let fixture: ComponentFixture<ImportLinksHost>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));

    const opening = TestBed.inject(LinksStore).open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: [analista], total: 1 } satisfies LinkPage);
    await opening;

    fixture = TestBed.createComponent(ImportLinksHost);
    await fixture.whenStable();

    TestBed.inject(MatDialog).open(ImportLinksDialog);
    await settle();
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  /** El diálogo se abre en el overlay, fuera del árbol del componente. */
  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  function dialogText(): string {
    return dialog().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function listText(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Pega el texto y pulsa Importar; devuelve la petición de importación, todavía sin responder. */
  async function paste(text: string): Promise<void> {
    typeInto(dialog(), '[data-testid="import-text"]', text);
    await fixture.whenStable();
    buttonWithText(dialog(), 'Importar').click();
    await settle();
    await fixture.whenStable();
  }

  /** Responde a la importación y a la recarga que el store encadena. */
  async function flushImport(
    response: ImportLinksResponse,
    items: JobLinkSummary[],
  ): Promise<void> {
    const request = http.expectOne({ method: 'POST', url: '/api/links/import' });
    expect(request.request.body).toEqual({ text: CHAT, groupId: 'g1' });
    request.flush(response, { status: 201, statusText: 'Created' });
    await settle();
    http.expectOne(GROUP_PAGE).flush({ items, total: items.length } satisfies LinkPage);
    await settle();
    await fixture.whenStable();
  }

  it('Importación con repetidos', async () => {
    await paste(CHAT);
    await flushImport(
      { created: 2, existing: 1, unrecognized: 0, skipped: 0, links: [analista, backend] },
      [analista, backend],
    );

    expect(dialogText()).toContain('2 guardadas, 1 ya estaba');
    expect(listText()).toContain('backend');
  });

  it('Importación sin enlaces', async () => {
    await paste(CHAT);
    await flushImport(empty, [analista]);

    expect(dialogText()).toContain('No encontramos ninguna oferta en ese texto');
    expect(dialogText()).not.toContain('guardadas');
    expect(listText()).toContain('analista');
    expect(listText()).not.toContain('backend');
  });

  it('Importación recortada a 50', async () => {
    await paste(CHAT);
    await flushImport(
      { created: 50, existing: 0, unrecognized: 0, skipped: 10, links: [] },
      [analista],
    );

    expect(dialogText()).toContain('Nos quedamos en 50: vuelve a pegar el mismo texto para continuar');
    expect(dialogText()).toContain('50 guardadas, 0 ya estaban');
  });

  it('Texto demasiado largo', async () => {
    await paste('a'.repeat(20_001));

    expect(dialogText()).toContain('Pega menos texto: hasta 20 000 caracteres');
    http.expectNone({ method: 'POST', url: '/api/links/import' });
  });

  it('counts the pasted characters', async () => {
    typeInto(dialog(), '[data-testid="import-text"]', 'hola');
    await fixture.whenStable();

    expect(dialog().querySelector('[data-testid="import-counter"]')?.textContent?.trim()).toBe(
      '4 / 20 000',
    );
  });

  it('reports the links it could not read with its plural', async () => {
    await paste(CHAT);
    await flushImport(
      { created: 1, existing: 0, unrecognized: 1, skipped: 0, links: [analista] },
      [analista],
    );

    expect(dialogText()).toContain('1 guardada, 0 ya estaban');
    expect(dialogText()).toContain('1 enlace no se pudo leer');
  });

  it('does not call the API with an empty box', async () => {
    buttonWithText(dialog(), 'Importar').click();
    await settle();

    http.expectNone({ method: 'POST', url: '/api/links/import' });
  });
});
