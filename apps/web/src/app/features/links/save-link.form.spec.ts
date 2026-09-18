import { HttpTestingController } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage, SaveLinkResponse } from '@linkvault/shared';
import {
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { LinkList } from './link-list.component';
import { SaveLinkForm } from './save-link.form';

const URL_TO_SAVE = 'https://www.linkedin.com/jobs/view/backend-engineer-en-acme-3912345678';
const GROUP_PAGE = '/api/groups/g1/links?limit=20';

const link: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: URL_TO_SAVE,
  platform: 'linkedin',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const saved: SaveLinkResponse = {
  link,
  created: true,
  shared: 'created',
  alreadyInGroups: [],
};

/** El detalle del grupo compone así el formulario y la lista: guardar recarga el store y la lista se repinta sola. */
@Component({
  selector: 'lv-save-link-host',
  imports: [LinkList, SaveLinkForm],
  template: `
    <lv-save-link-form />
    <lv-link-list [links]="items()" scope="group" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SaveLinkHost {
  readonly items = inject(LinksStore).items;
}

describe('SaveLinkForm', () => {
  let fixture: ComponentFixture<SaveLinkHost>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));

    const opening = TestBed.inject(LinksStore).open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: [], total: 0 } satisfies LinkPage);
    await opening;

    fixture = TestBed.createComponent(SaveLinkHost);
    await fixture.whenStable();
  });

  afterEach(() => verifyNoPendingRequests(http));

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function urlField(): HTMLInputElement {
    const input = host().querySelector<HTMLInputElement>('[data-testid="save-link-url"]');
    if (!input) {
      throw new Error('URL field not rendered');
    }
    return input;
  }

  /** Escribe la URL y pulsa Guardar; devuelve la petición de guardado, todavía sin responder. */
  async function save(url = URL_TO_SAVE): Promise<ReturnType<HttpTestingController['expectOne']>> {
    typeInto(host(), '[data-testid="save-link-url"]', url);
    await fixture.whenStable();
    buttonWithText(host(), 'Guardar').click();
    await settle();
    return http.expectOne({ method: 'POST', url: '/api/links' });
  }

  /** Responde a la recarga que el store encadena tras guardar. */
  async function flushReload(items: JobLinkSummary[]): Promise<void> {
    await settle();
    http.expectOne(GROUP_PAGE).flush({ items, total: items.length } satisfies LinkPage);
    await settle();
    await fixture.whenStable();
  }

  it('Link guardado', async () => {
    const request = await save();
    expect(request.request.body).toEqual({ url: URL_TO_SAVE, groupId: 'g1' });
    request.flush(saved, { status: 201, statusText: 'Created' });
    await flushReload([link]);

    expect(text()).toContain('backend engineer en acme 3912345678');
    expect(urlField().value).toBe('');
    expect(text()).not.toContain('Ya lo tienes en');
    expect(text()).not.toContain('Ya estaba aquí');
  });

  it('URL inválida', async () => {
    const request = await save('no-es-una-url');
    request.flush(
      { code: 'invalid_url', message: 'Invalid url' },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();
    await fixture.whenStable();

    expect(text()).toContain('Eso no parece un enlace de una oferta');
    expect(urlField().value).toBe('no-es-una-url');
    http.expectNone(GROUP_PAGE);
  });

  it('Aviso de link repetido', async () => {
    const request = await save();
    request.flush(
      { ...saved, created: false, alreadyInGroups: [{ id: 'g2', name: 'Backend Bolivia' }] },
      { status: 201, statusText: 'Created' },
    );
    await flushReload([link]);

    expect(text()).toContain('Ya lo tienes en: Backend Bolivia');
    expect(text()).not.toContain('Ya estaba aquí');
  });

  it('El link ya estaba en este grupo', async () => {
    const request = await save();
    request.flush(
      {
        ...saved,
        created: false,
        shared: 'already_there',
        sharedBy: { userId: 'u9', displayName: 'Ana' },
      },
      { status: 201, statusText: 'Created' },
    );
    await flushReload([link]);

    expect(text()).toContain('Ya estaba aquí, lo compartió Ana');
  });

  it('Vacante conocida compartida por primera vez', async () => {
    const request = await save();
    request.flush(
      { ...saved, created: false, shared: 'created' },
      { status: 201, statusText: 'Created' },
    );
    await flushReload([link]);

    expect(text()).toContain('backend engineer en acme 3912345678');
    expect(text()).not.toContain('Ya estaba aquí');
    expect(text()).not.toContain('Ya lo tienes en');
  });

  it('forgets the previous notice on the next save', async () => {
    const first = await save();
    first.flush(
      { ...saved, created: false, shared: 'already_there', sharedBy: { userId: 'u9', displayName: 'Ana' } },
      { status: 201, statusText: 'Created' },
    );
    await flushReload([link]);
    expect(text()).toContain('Ya estaba aquí, lo compartió Ana');

    const second = await save('https://ejemplo.test/ofertas/analista');
    second.flush(saved, { status: 201, statusText: 'Created' });
    await flushReload([link]);

    expect(text()).not.toContain('Ya estaba aquí');
  });

  it('does not call the API with an empty field', async () => {
    buttonWithText(host(), 'Guardar').click();
    await settle();

    http.expectNone({ method: 'POST', url: '/api/links' });
  });
});
