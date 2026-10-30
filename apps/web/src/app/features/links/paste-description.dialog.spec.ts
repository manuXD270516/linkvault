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

  /** Responde al pegado con un error de la API y espera a que el diálogo lo muestre. */
  async function failWith(
    code: string,
    status: number,
    headers: Record<string, string> = {},
  ): Promise<void> {
    const { body, options } = apiError(code, status, headers);
    http.expectOne({ method: 'POST', url: PASTED_URL }).flush(body, options);
    await settle();
    await fixture.whenStable();
  }

  function actions(): string[] {
    return Array.from(dialog().querySelectorAll('mat-dialog-actions button')).map(
      (button) => button.textContent?.trim() ?? '',
    );
  }

  function error(): string {
    return (
      dialog().querySelector('[data-testid="paste-error"]')?.textContent?.replace(/\s+/g, ' ').trim() ??
      ''
    );
  }

  const CAPACITY =
    'La IA no admite más lecturas por ahora y no sabemos cuándo vuelve. Puedes completarla a mano';

  describe('errors that tell the truth', () => {
    afterEach(() => vi.useRealTimers());

    it('503 ai_capacity_exhausted says no sabemos cuándo vuelve and Puedes completarla a mano', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_capacity_exhausted', 503);

      expect(error()).toBe(CAPACITY);
      expect(dialog().textContent).not.toContain('inténtalo en un rato');
      expect(field('text').value).toBe(PASTED_TEXT);
    });

    it('503 ai_capacity_exhausted ignores Retry-After', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_capacity_exhausted', 503, { 'Retry-After': '46800' });

      expect(error()).toBe(CAPACITY);
      expect(error()).not.toMatch(/\d{1,2}:\d{2}/);
    });

    it('503 extraction_disabled says Puedes completarla a mano', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('extraction_disabled', 503);

      expect(error()).toBe('La lectura automática no está disponible. Puedes completarla a mano');
      expect(dialog().textContent).not.toContain('inténtalo en un rato');
    });

    it('409 ai_consent_required says falta tu permiso and offers no link to /perfil', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_consent_required', 409);

      expect(error()).toBe('Para leerla con IA externa falta tu permiso. Puedes completarla a mano');
      expect(dialog().querySelector('a')).toBeNull();
      expect(dialog().innerHTML).not.toContain('/perfil');
    });

    it.each([
      ['not_a_job_posting', 422],
      ['too_many_attempts', 429],
      ['ai_quota_exceeded', 429],
      ['ai_capacity_exhausted', 503],
      ['extraction_disabled', 503],
      ['ai_consent_required', 409],
    ])('no message other than extraction_unavailable says en un rato (%s)', async (code, status) => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith(code, status, { 'Retry-After': '60' });

      expect(dialog().textContent).not.toContain('en un rato');
    });

    it('quota exceeded tells the real time, not mañana', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 30, 10, 0, 0, 0));
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_quota_exceeded', 429, { 'Retry-After': '10800' });

      expect(error()).toBe(
        'Llegaste a tu límite de lecturas con IA. Podrás volver a pegar hoy a las 13:00',
      );
      expect(dialog().textContent).not.toContain('vuelve mañana');
      expect(actions()).toEqual(['Completar a mano', 'Cancelar']);
      expect(field('text').value).toBe(PASTED_TEXT);
    });

    it('quota exceeded rounds the time up to the next minute', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 30, 10, 0, 30, 0));
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_quota_exceeded', 429, { 'Retry-After': '10800' });

      expect(error()).toContain('hoy a las 13:01');
    });

    it('quota exceeded past tomorrow says en 24 horas como mucho', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 30, 23, 59, 30, 0));
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_quota_exceeded', 429, { 'Retry-After': '86400' });

      expect(error()).toBe(
        'Llegaste a tu límite de lecturas con IA. Podrás volver a pegar en 24 horas como mucho',
      );
      expect(error()).not.toMatch(/\d{1,2}:\d{2}/);
    });

    it('quota exceeded without Retry-After says en 24 horas como mucho', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_quota_exceeded', 429);

      expect(error()).toContain('en 24 horas como mucho');
    });
  });

  describe('Completar a mano', () => {
    it('offers Completar a mano after not_a_job_posting and when offline', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('not_a_job_posting', 422);
      expect(dialog().querySelector('[data-testid="paste-complete-by-hand"]')).not.toBeNull();

      submitButton().click();
      await settle();
      http.expectOne({ method: 'POST', url: PASTED_URL }).error(new ProgressEvent('error'));
      await settle();
      await fixture.whenStable();

      expect(dialog().textContent).toContain('No pudimos conectar con LinkVault');
      expect(dialog().querySelector('[data-testid="paste-complete-by-hand"]')).not.toBeNull();
      expect(field('text').value).toBe(PASTED_TEXT);
    });

    it('does not offer Completar a mano before any failure', async () => {
      await showList([blocked]);
      await openDialog();
      expect(dialog().querySelector('[data-testid="paste-complete-by-hand"]')).toBeNull();
    });

    it('Completar a mano opens the edit dialog with the pasted text and the changed company', async () => {
      await showList([blocked]);
      await openDialog();
      typeInto(dialog(), '[data-testid="paste-company"]', 'Acme');
      await pasteAndSubmit();
      await failWith('ai_capacity_exhausted', 503);

      dialog().querySelector<HTMLButtonElement>('[data-testid="paste-complete-by-hand"]')?.click();
      await settle();
      await fixture.whenStable();
      await vi.waitFor(() =>
        expect(
          document.body.querySelector('[data-testid="edit-paste-reference-text"]'),
        ).not.toBeNull(),
      );

      // El de pegar se cierra con su animación y queda solo la corrección a mano.
      await vi.waitFor(() =>
        expect(document.body.querySelectorAll('mat-dialog-container')).toHaveLength(1),
      );
      const reference = document.body.querySelector<HTMLTextAreaElement>(
        '[data-testid="edit-paste-reference-text"]',
      );
      expect(reference?.value).toBe(PASTED_TEXT);
      expect(reference?.hasAttribute('disabled')).toBe(false);
      expect(
        document.body.querySelector<HTMLInputElement>('[data-testid="preview-company"]')?.value,
      ).toBe('Acme');
      // El título no se tocó en el pegado: el formulario conserva el de la tarjeta (ninguno).
      expect(
        document.body.querySelector<HTMLInputElement>('[data-testid="preview-title"]')?.value,
      ).toBe('');
    });

    it('the pasted text is not written to the links store', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('extraction_disabled', 503);

      dialog().querySelector<HTMLButtonElement>('[data-testid="paste-complete-by-hand"]')?.click();
      await settle();
      await fixture.whenStable();

      const store = TestBed.inject(LinksStore);
      expect(JSON.stringify(store.items())).not.toContain('Airflow');
      expect(JSON.stringify(store.items())).toEqual(JSON.stringify([blocked]));
    });
  });

  describe('actions', () => {
    it('capacity exhausted makes Completar a mano primary and Reintentar secondary', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('ai_capacity_exhausted', 503);

      expect(dialog().querySelector('[data-testid="paste-complete-by-hand"]')?.className).toContain(
        'mat-mdc-unelevated-button',
      );
      expect(dialog().querySelector('[data-testid="paste-retry"]')?.className).toContain(
        'mat-mdc-outlined-button',
      );
      expect(dialog().querySelector('[data-testid="paste-submit"]')).toBeNull();

      // Reintentar vuelve a enviar lo mismo, sin pegar de nuevo.
      dialog().querySelector<HTMLButtonElement>('[data-testid="paste-retry"]')?.click();
      await settle();
      const retried = http.expectOne({ method: 'POST', url: PASTED_URL });
      expect(retried.request.body).toEqual({ text: PASTED_TEXT });
      retried.flush(completed);
      await settle();
      await closed();
    });

    it.each([
      ['ai_quota_exceeded', 429],
      ['extraction_disabled', 503],
      ['ai_consent_required', 409],
    ])('quota exceeded, disabled and consent required hide resend (%s)', async (code, status) => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith(code, status, { 'Retry-After': '3600' });

      expect(dialog().querySelector('[data-testid="paste-retry"]')).toBeNull();
      expect(dialog().querySelector('[data-testid="paste-submit"]')).toBeNull();
      expect(dialog().querySelector('[data-testid="paste-complete-by-hand"]')?.className).toContain(
        'mat-mdc-unelevated-button',
      );
    });

    it('extraction_unavailable keeps resend primary', async () => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith('extraction_unavailable', 503, { 'Retry-After': '60' });

      expect(submitButton().className).toContain('mat-mdc-unelevated-button');
      expect(submitButton().disabled).toBe(false);
      expect(dialog().querySelector('[data-testid="paste-complete-by-hand"]')?.className).toContain(
        'mat-mdc-outlined-button',
      );
    });

    it.each([
      ['ai_capacity_exhausted', 503, ['Completar a mano', 'Reintentar', 'Cancelar']],
      ['ai_quota_exceeded', 429, ['Completar a mano', 'Cancelar']],
      ['extraction_disabled', 503, ['Completar a mano', 'Cancelar']],
      ['extraction_unavailable', 503, ['Completar la oferta', 'Completar a mano', 'Cancelar']],
    ])('actions are ordered primary, secondary, cancel (%s)', async (code, status, order) => {
      await showList([blocked]);
      await openDialog();
      await pasteAndSubmit();
      await failWith(code, status);

      expect(actions()).toEqual(order);
    });
  });
});
