import { HttpTestingController } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { JobLinkSummary, LinkPage } from '@linkvault/shared';
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
import { LinkList, type LinkListScope } from './link-list.component';

const GROUP_PAGE = '/api/groups/g1/links?limit=20';
const PREVIEW_URL = '/api/links/l1/preview';

/**
 * Oferta leída de la página con el título ya corregido a mano por Ana (que desplazó el que traía la página), la empresa
 * leída del JSON-LD y el salario deducido por la IA: los tres orígenes que el formulario tiene que distinguir.
 */
const link: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://ejemplo.test/ofertas/1',
  displayUrl: 'https://ejemplo.test/ofertas/ingeniera-de-datos',
  platform: 'generic',
  previewStatus: 'manual',
  previewVersion: 3,
  preview: {
    title: 'Ingeniera de datos',
    company: 'Acme',
    salary: { min: 8000, max: null, currency: 'BOB', period: 'month' },
  },
  previewSources: {
    title: {
      value: 'Ingeniera de datos',
      source: 'manual',
      by: { userId: 'u1', displayName: 'Ana' },
      at: '2026-09-18T10:00:00.000Z',
      replaced: { value: 'Data Engineer (m/f)', source: 'auto', extractor: 'metadata' },
    },
    company: {
      value: 'Acme',
      source: 'auto',
      extractor: 'json-ld',
      at: '2026-09-18T09:00:00.000Z',
    },
    salary: {
      value: { min: 8000, max: null, currency: 'BOB', period: 'month' },
      source: 'auto',
      extractor: 'ai:extract-job',
      at: '2026-09-18T09:00:00.000Z',
    },
  },
  sharedBy: { userId: 'u2', displayName: 'Beto' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

/** La lista tal y como la componen el detalle del grupo y `/mis-links`: los links salen del store. */
@Component({
  selector: 'lv-edit-preview-host',
  imports: [LinkList],
  template: `<lv-link-list [links]="items()" [scope]="scope()" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class EditHost {
  readonly items = inject(LinksStore).items;
  readonly scope = signal<LinkListScope>('group');
}

describe('EditPreviewDialog', () => {
  let fixture: ComponentFixture<EditHost>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));

    const opening = TestBed.inject(LinksStore).open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: [link], total: 1 } satisfies LinkPage);
    await opening;

    fixture = TestBed.createComponent(EditHost);
    await fixture.whenStable();
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

  async function openDialog(): Promise<void> {
    const edit = host().querySelector<HTMLButtonElement>('[data-testid="link-edit"]');
    if (!edit) {
      throw new Error('The card does not offer to edit');
    }
    edit.click();
    await settle();
    await fixture.whenStable();
  }

  async function save(): Promise<void> {
    dialog().querySelector<HTMLButtonElement>('[data-testid="preview-save"]')?.click();
    await settle();
  }

  /** El diálogo se cierra con una animación corta, así que su desaparición se espera en vez de darse por hecha. */
  async function closed(): Promise<void> {
    await vi.waitFor(() =>
      expect(document.body.querySelector('mat-dialog-container')).toBeNull(),
    );
  }

  function originOf(field: string): string {
    return dialog().querySelector(`[data-testid="origin-${field}"]`)?.textContent?.trim() ?? '';
  }

  function valueOf(field: string): string {
    return dialog().querySelector<HTMLInputElement>(`[data-testid="preview-${field}"]`)?.value ?? '';
  }

  it('Corregir el título', async () => {
    await openDialog();
    typeInto(dialog(), '[data-testid="preview-title"]', 'Ingeniera de datos senior');
    await save();

    // Solo viaja lo que cambió: lo demás seguiría siendo automático y una relectura podría mejorarlo.
    const request = http.expectOne({ method: 'PATCH', url: PREVIEW_URL });
    expect(request.request.body).toEqual({ fields: { title: 'Ingeniera de datos senior' } });

    request.flush({
      ...link,
      previewVersion: 4,
      preview: { ...link.preview, title: 'Ingeniera de datos senior' },
      previewSources: {
        ...link.previewSources,
        title: {
          value: 'Ingeniera de datos senior',
          source: 'manual',
          by: { userId: 'u1', displayName: 'Ana' },
          at: '2026-09-18T12:00:00.000Z',
        },
      },
    } satisfies JobLinkSummary);
    await settle();
    await fixture.whenStable();

    await closed();
    expect(host().textContent).toContain('Ingeniera de datos senior');
    expect(host().textContent).toContain('Escrito por Ana');
  });

  it('Origen de cada campo', async () => {
    await openDialog();

    expect(originOf('title')).toBe('Escrito por Ana');
    expect(originOf('company')).toBe('Leído de la página');
    expect(originOf('salary')).toBe('Deducido por la IA');
    // Nadie ha escrito la ubicación: no hay nada que decir de ella.
    expect(dialog().querySelector('[data-testid="origin-location"]')).toBeNull();
  });

  it('Volver a lo extraído', async () => {
    await openDialog();
    expect(valueOf('title')).toBe('Ingeniera de datos');

    dialog().querySelector<HTMLButtonElement>('[data-testid="revert-title"]')?.click();
    await fixture.whenStable();

    // Se ve a qué se va a volver antes de guardar.
    expect(valueOf('title')).toBe('Data Engineer (m/f)');
    await save();

    const request = http.expectOne({ method: 'PATCH', url: PREVIEW_URL });
    expect(request.request.body).toEqual({ revert: ['title'] });

    request.flush({
      ...link,
      previewVersion: 4,
      preview: { ...link.preview, title: 'Data Engineer (m/f)' },
      previewSources: {
        ...link.previewSources,
        title: {
          value: 'Data Engineer (m/f)',
          source: 'auto',
          extractor: 'metadata',
          at: '2026-09-18T09:00:00.000Z',
        },
      },
    } satisfies JobLinkSummary);
    await settle();
    await fixture.whenStable();

    expect(host().textContent).toContain('Data Engineer (m/f)');
  });

  it('Error al guardar', async () => {
    await openDialog();
    typeInto(dialog(), '[data-testid="preview-company"]', 'Acme Bolivia');
    await save();

    http
      .expectOne({ method: 'PATCH', url: PREVIEW_URL })
      .flush({ code: 'internal_error', message: 'internal_error' }, {
        status: 500,
        statusText: 'Internal Server Error',
      });
    await settle();
    await fixture.whenStable();

    expect(dialog().textContent).toContain('Algo salió mal. Inténtalo de nuevo');
    // Lo escrito se conserva: volver a escribirlo todo por un fallo del servidor es lo que no puede pasar.
    expect(valueOf('company')).toBe('Acme Bolivia');
  });

  it('closes without asking anything when nothing changed', async () => {
    await openDialog();
    await save();

    http.expectNone({ method: 'PATCH', url: PREVIEW_URL });
    await closed();
  });

  it('offers to finish by hand what could not be read', async () => {
    const opening = TestBed.inject(LinksStore).open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({
      items: [{ ...link, previewStatus: 'failed', preview: undefined, previewSources: undefined }],
      total: 1,
    } satisfies LinkPage);
    await opening;
    await fixture.whenStable();

    buttonWithText(host(), 'Completar a mano').click();
    await settle();
    await fixture.whenStable();

    expect(dialog().textContent).toContain('Corregir la oferta');
  });

  /** Carga en la lista otro link en lugar del de partida, como si la persona abriera otra pantalla. */
  async function showOnly(other: JobLinkSummary): Promise<void> {
    const opening = TestBed.inject(LinksStore).open({ kind: 'group', groupId: 'g1' });
    http.expectOne(GROUP_PAGE).flush({ items: [other], total: 1 } satisfies LinkPage);
    await opening;
    await fixture.whenStable();
  }

  const beto = { userId: 'u2', displayName: 'Beto' };

  /** La empresa la sacó la IA del texto que pegó Beto; el título lo corrigió Ana encima de lo que pegó Beto. */
  const pastedLink: JobLinkSummary = {
    ...link,
    preview: { title: 'Ingeniera de datos', company: 'Acme' },
    previewSources: {
      title: {
        value: 'Ingeniera de datos',
        source: 'manual',
        by: { userId: 'u1', displayName: 'Ana' },
        at: '2026-09-18T11:00:00.000Z',
        replaced: {
          value: 'Data Engineer',
          source: 'pasted',
          extractor: 'ai:extract-pasted-job',
          by: beto,
          at: '2026-09-18T10:00:00.000Z',
        },
      },
      company: {
        value: 'Acme',
        source: 'pasted',
        extractor: 'ai:extract-pasted-job',
        by: beto,
        at: '2026-09-18T10:00:00.000Z',
      },
    },
  };

  it('Lo pegado se distingue', async () => {
    await showOnly(pastedLink);
    await openDialog();

    expect(originOf('company')).toBe('Descripción pegada por Beto');
    expect(originOf('title')).toBe('Escrito por Ana');
    // Lo pegado sobre un campo vacío no desplazó nada: no hay "anterior" al que volver.
    expect(dialog().querySelector('[data-testid="revert-company"]')).toBeNull();
  });

  it('Volver a lo pegado', async () => {
    await showOnly(pastedLink);
    await openDialog();

    const revert = dialog().querySelector<HTMLButtonElement>('[data-testid="revert-title"]');
    expect(revert?.textContent?.trim()).toBe('Volver a lo anterior');
    revert?.click();
    await fixture.whenStable();
    expect(valueOf('title')).toBe('Data Engineer');
    await save();

    const request = http.expectOne({ method: 'PATCH', url: PREVIEW_URL });
    expect(request.request.body).toEqual({ revert: ['title'] });
    request.flush({
      ...pastedLink,
      previewVersion: 4,
      preview: { title: 'Data Engineer', company: 'Acme' },
      previewSources: {
        ...pastedLink.previewSources,
        title: {
          value: 'Data Engineer',
          source: 'pasted',
          extractor: 'ai:extract-pasted-job',
          by: beto,
          at: '2026-09-18T10:00:00.000Z',
        },
      },
    } satisfies JobLinkSummary);
    await settle();
    await fixture.whenStable();

    await closed();
    expect(host().querySelector('[data-testid="link-open"]')?.textContent?.trim()).toBe('Data Engineer');
    expect(host().querySelector('[data-testid="note-title"]')?.textContent?.trim()).toBe(
      'Descripción pegada por Beto',
    );
  });
});
