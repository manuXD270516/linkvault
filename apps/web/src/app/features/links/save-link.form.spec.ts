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

  describe('el enlace público del grupo', () => {
    const share = {
      slug: 'k3m9qrtv2xyz',
      url: 'http://localhost:3000/p/k3m9qrtv2xyz',
      publishedAt: '2026-09-19T10:00:00.000Z',
    };

    /** Portapapeles falso; jsdom no trae uno. */
    function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)): typeof writeText {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      return writeText;
    }

    it('Guardado en un grupo que comparte en público', async () => {
      const request = await save();
      request.flush(
        { ...saved, link: { ...link, publicShare: share } } satisfies SaveLinkResponse,
        { status: 201, statusText: 'Created' },
      );
      await flushReload([{ ...link, publicShare: share }]);

      expect(text()).toContain(
        'Cualquiera con este enlace verá la oferta; no se verá el grupo ni tu nombre',
      );
      expect(host().querySelector('[data-testid="save-link-copy-public"]')).not.toBeNull();
    });

    it('Guardado en un grupo que no comparte en público', async () => {
      const request = await save();
      request.flush(saved, { status: 201, statusText: 'Created' });
      await flushReload([link]);

      expect(text()).not.toContain('Cualquiera con este enlace verá la oferta');
      expect(host().querySelector('[data-testid="save-link-copy-public"]')).toBeNull();
    });

    it('Copiar el enlace de una oferta recién guardada', async () => {
      const writeText = stubClipboard();
      const request = await save();
      request.flush(
        { ...saved, link: { ...link, publicShare: share } } satisfies SaveLinkResponse,
        { status: 201, statusText: 'Created' },
      );
      await flushReload([{ ...link, publicShare: share }]);

      // La oferta todavía está en `pending`: se avisa y se copia igualmente.
      expect(text()).toContain(
        'Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos',
      );
      host().querySelector<HTMLButtonElement>('[data-testid="save-link-copy-public"]')?.click();
      await settle();
      await fixture.whenStable();

      expect(writeText).toHaveBeenCalledWith(share.url);
      expect(text()).toContain('Enlace copiado');
      // El enlace venía en la respuesta: copiarlo no cuesta ninguna petición más.
      http.expectNone({ method: 'GET', url: `/api/public/previews/${share.slug}` });
      http.expectNone({ method: 'PUT', url: '/api/groups/g1/links/l1/public' });
    });

    it('does not warn about an unread job when the preview is already there', async () => {
      stubClipboard();
      const read: JobLinkSummary = { ...link, previewStatus: 'enriched', publicShare: share };
      const request = await save();
      request.flush({ ...saved, link: read } satisfies SaveLinkResponse, {
        status: 201,
        statusText: 'Created',
      });
      await flushReload([read]);

      expect(text()).not.toContain('Todavía estamos leyendo la oferta');
      expect(text()).toContain('Cualquiera con este enlace verá la oferta');
    });
  });

  describe('nota para el grupo', () => {
    function noteField(): HTMLTextAreaElement | null {
      return host().querySelector<HTMLTextAreaElement>('[data-testid="save-link-note"]');
    }

    async function writeNote(note: string): Promise<void> {
      const field = noteField();
      if (!field) {
        throw new Error('Note field not rendered');
      }
      field.value = note;
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    }

    it('Compartir con nota', async () => {
      expect(host().textContent).toContain('Nota para el grupo (opcional)');
      expect(noteField()?.placeholder).toBe('Por ejemplo: esta es la que te dije');

      await writeNote('Esta es la que te dije');
      const request = await save();
      expect(request.request.body).toEqual({
        url: URL_TO_SAVE,
        groupId: 'g1',
        note: 'Esta es la que te dije',
      });
      request.flush(saved, { status: 201, statusText: 'Created' });
      await flushReload([
        { ...link, note: { text: 'Esta es la que te dije', createdAt: link.sharedAt } },
      ]);

      expect(host().querySelector('[data-testid="link-note-author"]')?.textContent?.trim()).toBe(
        'Nota de Ana',
      );
      expect(host().querySelector('[data-testid="link-note-text"]')?.textContent).toBe(
        'Esta es la que te dije',
      );
      expect(noteField()?.value).toBe('');
      expect(text()).not.toContain('Tu nota no se añadió');
    });

    it('La oferta ya estaba', async () => {
      await writeNote('Yo también la vi');
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
      expect(text()).toContain('Tu nota no se añadió porque la oferta ya estaba en el grupo.');
      expect(noteField()?.value).toBe('Yo también la vi');
      expect(urlField().value).toBe('');
    });

    it('says nothing about the note when none was written', async () => {
      const request = await save();
      expect(request.request.body).toEqual({ url: URL_TO_SAVE, groupId: 'g1' });
      request.flush(
        { ...saved, created: false, shared: 'already_there', sharedBy: { userId: 'u9', displayName: 'Ana' } },
        { status: 201, statusText: 'Created' },
      );
      await flushReload([link]);

      expect(text()).not.toContain('Tu nota no se añadió');
    });

    it('counts the note up to 280 and does not save a longer one', async () => {
      await writeNote(`  ${'n'.repeat(280)}  `);
      expect(host().querySelector('[data-testid="save-link-note-counter"]')?.textContent?.trim()).toBe(
        '280/280',
      );

      expect(host().querySelector('[data-testid="save-link-note-too-long"]')).toBeNull();

      await writeNote('n'.repeat(281));
      expect(host().querySelector('[data-testid="save-link-note-counter"]')?.textContent?.trim()).toBe(
        '281/280',
      );
      typeInto(host(), '[data-testid="save-link-url"]', URL_TO_SAVE);
      await fixture.whenStable();
      buttonWithText(host(), 'Guardar').click();
      await settle();
      await fixture.whenStable();

      http.expectNone({ method: 'POST', url: '/api/links' });
      expect(host().querySelector('[data-testid="save-link-note-too-long"]')?.textContent?.trim()).toBe(
        'Máximo 280 caracteres',
      );
    });

    it('Sin nota en la lista privada', async () => {
      const opening = TestBed.inject(LinksStore).open({ kind: 'mine' });
      http.expectOne('/api/links/mine?limit=20').flush({ items: [], total: 0 } satisfies LinkPage);
      await opening;
      await fixture.whenStable();

      expect(noteField()).toBeNull();
      expect(host().textContent).not.toContain('Nota para el grupo');
    });
  });
});
