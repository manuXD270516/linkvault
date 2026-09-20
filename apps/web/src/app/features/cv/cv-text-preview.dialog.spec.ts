import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import type { CvTextPreviewResponse } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import {
  CvTextPreviewDialog,
  type CvTextPreviewResult,
} from './cv-text-preview.dialog';

const preview: CvTextPreviewResponse = {
  status: 'extracted',
  text: 'Ana Pérez\nDesarrolladora backend\nExperiencia: cinco años con Node y PostgreSQL',
  chars: 74,
  complete: false,
};

describe('CvTextPreviewDialog', () => {
  let http: HttpTestingController;
  let closed: Promise<CvTextPreviewResult>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    verifyNoPendingRequests(http);
  });

  /** Abre el diálogo y deja lista la petición de la vista previa. */
  async function openDialog(): Promise<void> {
    const dialogRef = TestBed.inject(MatDialog).open<CvTextPreviewDialog, { cvId: string }, CvTextPreviewResult>(
      CvTextPreviewDialog,
      { data: { cvId: 'cv1' } },
    );
    closed = firstValueFrom(dialogRef.afterClosed());
    TestBed.tick();
    await settle();
  }

  function dialog(): HTMLElement {
    const element = document.body.querySelector<HTMLElement>('lv-cv-text-preview-dialog');
    if (!element) {
      throw new Error('Dialog not rendered');
    }
    return element;
  }

  function text(): string {
    return dialog().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function answer(flush: () => void): Promise<void> {
    flush();
    await settle();
    TestBed.tick();
    await settle();
  }

  it('Mirar lo leído', async () => {
    await openDialog();

    await answer(() =>
      http.expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' }).flush(preview),
    );

    expect(dialog().querySelector('[data-testid="cv-preview-text"]')?.textContent).toContain(
      'Desarrolladora backend',
    );
    expect(text()).toContain(
      'Así leímos tu CV. Si ves el texto desordenado, vuelve a exportarlo desde tu editor y súbelo otra vez.',
    );
  });

  it('Sin botones de salida', async () => {
    await openDialog();
    await answer(() =>
      http.expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' }).flush(preview),
    );

    const actions = Array.from(dialog().querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );
    expect(actions).toEqual(['Cerrar']);
    expect(dialog().querySelectorAll('a')).toHaveLength(0);
    for (const forbidden of ['Copiar', 'Descargar', 'Compartir']) {
      expect.soft(text()).not.toContain(forbidden);
    }
  });

  it('El CV se borró en otra pestaña', async () => {
    await openDialog();

    const { body, options } = apiError('cv_not_found', 404);
    await answer(() =>
      http.expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' }).flush(body, options),
    );

    // El diálogo se cierra diciendo que ya no está; quien lo abrió lo dice y recarga la lista.
    await expect(closed).resolves.toBe('gone');
    expect(document.body.querySelector('lv-cv-text-preview-dialog')).toBeNull();
  });

  it('Límite de vistas previas', async () => {
    await openDialog();

    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '900' });
    await answer(() =>
      http.expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' }).flush(body, options),
    );

    expect(text()).toContain('Demasiados intentos. Vuelve a intentarlo en 15 minutos');
    expect(text()).toContain('Reintentar');

    dialog().querySelector<HTMLButtonElement>('[data-testid="cv-preview-retry"]')?.click();
    await answer(() =>
      http.expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' }).flush(preview),
    );

    expect(text()).not.toContain('Demasiados intentos');
    expect(dialog().querySelector('[data-testid="cv-preview-text"]')).not.toBeNull();
  });

  it('Avería al mostrar lo leído', async () => {
    await openDialog();

    const { body, options } = apiError('internal_error', 500);
    await answer(() =>
      http.expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' }).flush(body, options),
    );

    expect(text()).toContain('No pudimos mostrarlo ahora');
    expect(text()).toContain('Reintentar');
  });

  it('un CV sin texto no deja el diálogo en blanco', async () => {
    await openDialog();

    await answer(() =>
      http
        .expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' })
        .flush({ status: 'pending', text: '', chars: 0, complete: false }),
    );

    expect(text()).toContain('No pudimos mostrarlo ahora');
  });
});
