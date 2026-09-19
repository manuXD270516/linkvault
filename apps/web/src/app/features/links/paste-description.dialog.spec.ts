import { HttpTestingController } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LinksStore } from '../../core/links/links.store';
import { LinkList } from './link-list.component';

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const PASTED_URL = '/api/links/l1/pasted';
const PREVIEW_URL = '/api/links/l1/preview';

const ana = { userId: 'u1', displayName: 'Ana' };

/** Texto copiado desde la app de LinkedIn: la descripción, sin el puesto ni la empresa de la cabecera. */
const PASTED_TEXT = `Acerca del empleo
Buscamos una persona para el equipo de datos, en remoto desde Bolivia.
Requisitos: Python, SQL y experiencia con Airflow.`;

/** Link de LinkedIn que la bolsa no deja leer y del que todavía no hay nada. */
const blocked: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678/?utm_source=share',
  platform: 'linkedin',
  previewStatus: 'failed',
  previewVersion: 2,
  previewRequestedAt: '2026-09-18T09:00:00.000Z',
  lastEnrichmentError: { reason: 'robots_disallowed', at: '2026-09-18T09:00:05.000Z' },
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-18T09:00:00.000Z',
};

/** El mismo link completado con lo pegado: la cabecera escrita a mano por Ana y el resto sacado del texto. */
const completed: JobLinkSummary = {
  ...blocked,
  previewStatus: 'manual',
  previewVersion: 3,
  preview: {
    title: 'Ingeniera de datos',
    company: 'Acme',
    location: 'Bolivia',
    modality: 'remote',
  },
  previewSources: {
    title: { value: 'Ingeniera de datos', source: 'manual', by: ana, at: '2026-09-18T12:00:00.000Z' },
    company: { value: 'Acme', source: 'manual', by: ana, at: '2026-09-18T12:00:00.000Z' },
    location: {
      value: 'Bolivia',
      source: 'pasted',
      extractor: 'ai:extract-pasted-job',
      by: ana,
      at: '2026-09-18T12:00:00.000Z',
    },
    modality: {
      value: 'remote',
      source: 'pasted',
      extractor: 'ai:extract-pasted-job',
      by: ana,
      at: '2026-09-18T12:00:00.000Z',
    },
  },
};

/** La lista tal y como la componen el detalle del grupo y `/mis-links`: los links salen del store. */
@Component({
  selector: 'lv-paste-host',
  imports: [LinkList],
  template: `<lv-link-list [links]="items()" scope="group" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PasteHost {
  readonly items = inject(LinksStore).items;
}

describe('PasteDescriptionDialog', () => {
  let fixture: ComponentFixture<PasteHost>;
  let http: HttpTestingController;

  async function showList(links: JobLinkSummary[]): Promise<void> {
    const opening = TestBed.inject(LinksStore).open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: links, total: links.length } satisfies LinkPage);
    await opening;
    fixture = TestBed.createComponent(PasteHost);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  function field(name: 'text' | 'title' | 'company'): HTMLInputElement | HTMLTextAreaElement {
    const element = dialog().querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-testid="paste-${name}"]`,
    );
    if (!element) {
      throw new Error(`Field "${name}" not found`);
    }
    return element;
  }

  function submitButton(): HTMLButtonElement {
    const button = dialog().querySelector<HTMLButtonElement>('[data-testid="paste-submit"]');
    if (!button) {
      throw new Error('Submit button not found');
    }
    return button;
  }

  async function openDialog(): Promise<void> {
    const paste = host().querySelector<HTMLButtonElement>('[data-testid="link-paste"]');
    if (!paste) {
      throw new Error('The card does not offer to paste the description');
    }
    paste.click();
    await settle();
    await fixture.whenStable();
  }

  async function pasteAndSubmit(text: string = PASTED_TEXT): Promise<void> {
    typeInto(dialog(), '[data-testid="paste-text"]', text);
    await fixture.whenStable();
    submitButton().click();
    await settle();
    await fixture.whenStable();
  }

  async function closed(): Promise<void> {
    await vi.waitFor(() =>
      expect(document.body.querySelector('mat-dialog-container')).toBeNull(),
    );
  }

  it('Completar una oferta de LinkedIn', async () => {
    await showList([blocked]);
    expect(host().textContent).toContain(
      'LinkedIn no nos deja leer sus ofertas. Pega su descripción para completarla',
    );

    await openDialog();
    expect(dialog().textContent).toContain(
      'Pega el texto de la oferta tal como la ves: lo leemos para completar la tarjeta y no lo guardamos',
    );
    typeInto(dialog(), '[data-testid="paste-title"]', 'Ingeniera de datos');
    typeInto(dialog(), '[data-testid="paste-company"]', 'Acme');
    await pasteAndSubmit();

    const request = http.expectOne({ method: 'POST', url: PASTED_URL });
    expect(request.request.body).toEqual({
      text: PASTED_TEXT,
      title: 'Ingeniera de datos',
      company: 'Acme',
    });
    request.flush(completed);
    await settle();
    await fixture.whenStable();

    await closed();
    // Sin recargar la lista: la tarjeta es la que devolvió la API.
    http.expectNone(GROUP_PAGE);
    const card = host().textContent ?? '';
    expect(card).toContain('Ingeniera de datos');
    expect(card).toContain('Acme');
    expect(host().querySelector('[data-testid="note-location"]')?.textContent?.trim()).toBe(
      'Descripción pegada por Ana',
    );
    expect(host().querySelector('[data-testid="note-modality"]')?.textContent?.trim()).toBe(
      'Descripción pegada por Ana',
    );
  });

  /** Lo precargado que nadie tocó no viaja: si no, cada pegado atribuiría a quien pega un título que leyó la página. */
  it('sends the title and the company only when the person changed them', async () => {
    await showList([
      {
        ...blocked,
        previewStatus: 'partial',
        preview: { title: 'Data Engineer', company: 'Acme' },
      },
    ]);

    await openDialog();
    expect(field('title').value).toBe('Data Engineer');
    expect(field('company').value).toBe('Acme');
    typeInto(dialog(), '[data-testid="paste-company"]', 'Acme Bolivia');
    await pasteAndSubmit();

    const request = http.expectOne({ method: 'POST', url: PASTED_URL });
    expect(request.request.body).toEqual({ text: PASTED_TEXT, company: 'Acme Bolivia' });
    request.flush(completed);
    await settle();
    await closed();
  });

  it('Leyendo lo pegado', async () => {
    await showList([blocked]);
    await openDialog();
    await pasteAndSubmit();

    expect(dialog().querySelector('[data-testid="paste-reading"]')?.textContent?.trim()).toBe(
      'Leyendo… puede tardar unos segundos',
    );
    expect(submitButton().disabled).toBe(true);
    submitButton().click();
    await settle();

    // Una sola petición, aunque se pulse otra vez: `expectOne` falla si hubiera dos.
    http.expectOne({ method: 'POST', url: PASTED_URL }).flush(completed);
    await settle();
    await closed();
  });

  it('Se pegó otra cosa', async () => {
    await showList([blocked]);
    await openDialog();
    await pasteAndSubmit('Ana: mira esta oferta\nBeto: gracias, la reviso mañana');

    const { body, options } = apiError('not_a_job_posting', 422);
    http.expectOne({ method: 'POST', url: PASTED_URL }).flush(body, options);
    await settle();
    await fixture.whenStable();

    expect(dialog().textContent).toContain(
      'Eso no parece una oferta de trabajo. Copia la descripción de la oferta, no la conversación',
    );
    expect(field('text').value).toBe('Ana: mira esta oferta\nBeto: gracias, la reviso mañana');
  });

  it('Límite de lecturas del día', async () => {
    await showList([blocked]);
    await openDialog();
    await pasteAndSubmit();

    const { body, options } = apiError('ai_quota_exceeded', 429, { 'Retry-After': '36000' });
    http.expectOne({ method: 'POST', url: PASTED_URL }).flush(body, options);
    await settle();
    await fixture.whenStable();

    expect(dialog().textContent).toContain('Llegaste al límite de lecturas de hoy, vuelve mañana');
    expect(dialog().textContent).not.toContain('espera un poco');
    expect(field('text').value).toBe(PASTED_TEXT);
  });

  it.each([
    ['too_many_attempts', 429, 'Pegaste demasiadas ofertas seguidas, espera un poco'],
    ['extraction_unavailable', 503, 'No pudimos leerla ahora, inténtalo en un rato'],
  ])('explains %s and keeps what was pasted', async (code, status, message) => {
    await showList([blocked]);
    await openDialog();
    typeInto(dialog(), '[data-testid="paste-title"]', 'Ingeniera de datos');
    await pasteAndSubmit();

    const { body, options } = apiError(code, status, { 'Retry-After': '60' });
    http.expectOne({ method: 'POST', url: PASTED_URL }).flush(body, options);
    await settle();
    await fixture.whenStable();

    expect(dialog().textContent).toContain(message);
    expect(field('text').value).toBe(PASTED_TEXT);
    expect(field('title').value).toBe('Ingeniera de datos');
    // Se puede volver a intentar sin pegar de nuevo.
    expect(submitButton().disabled).toBe(false);
  });

  it('does not send an empty text', async () => {
    await showList([blocked]);
    await openDialog();
    await pasteAndSubmit('   ');

    expect(submitButton().disabled).toBe(true);
    http.expectNone({ method: 'POST', url: PASTED_URL });
  });

  it('Deshacer un pegado con la cabecera escrita aparte', async () => {
    await showList([completed]);

    const undo = host().querySelector<HTMLButtonElement>('[data-testid="link-undo-paste"]');
    expect(undo?.textContent?.trim()).toBe('Deshacer lo que pegó Ana');
    undo?.click();
    await settle();

    // El título y la empresa se teclearon en el mismo diálogo: son parte del gesto y se deshacen con él.
    const request = http.expectOne({ method: 'PATCH', url: PREVIEW_URL });
    expect(request.request.body).toEqual({ revert: ['title', 'company', 'location', 'modality'] });
    request.flush({ ...blocked, previewVersion: 4 } satisfies JobLinkSummary);
    await settle();
    await fixture.whenStable();

    expect(host().querySelector('[data-testid="link-status"]')?.textContent?.trim()).toBe(
      'LinkedIn no nos deja leer sus ofertas. Pega su descripción para completarla',
    );
    expect(host().querySelector('[data-testid="link-undo-paste"]')).toBeNull();
  });

  it('Deshacer todo un pegado', async () => {
    // Ana corrigió a mano el título y la empresa después de pegar: eso ya no es parte del pegado.
    const corrected = '2026-09-18T13:00:00.000Z';
    await showList([
      {
        ...completed,
        previewSources: {
          ...completed.previewSources,
          title: { value: 'Ingeniera de datos', source: 'manual', by: ana, at: corrected },
          company: { value: 'Acme', source: 'manual', by: ana, at: corrected },
        },
      },
    ]);

    const undo = host().querySelector<HTMLButtonElement>('[data-testid="link-undo-paste"]');
    expect(undo?.textContent?.trim()).toBe('Deshacer lo que pegó Ana');
    undo?.click();
    await settle();

    // Todos los campos de ese pegado, en una sola operación; la corrección posterior se queda como está.
    const request = http.expectOne({ method: 'PATCH', url: PREVIEW_URL });
    expect(request.request.body).toEqual({ revert: ['location', 'modality'] });
    request.flush({
      ...completed,
      previewVersion: 4,
      preview: { title: 'Ingeniera de datos', company: 'Acme' },
      previewSources: {
        title: completed.previewSources?.title,
        company: completed.previewSources?.company,
      },
    } satisfies JobLinkSummary);
    await settle();
    await fixture.whenStable();

    expect(host().querySelector('[data-testid="link-location"]')).toBeNull();
    expect(host().querySelector('[data-testid="link-undo-paste"]')).toBeNull();
  });
});
