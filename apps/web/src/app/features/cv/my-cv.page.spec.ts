import { HttpEventType } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CvDocument } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { CvStore } from '../../core/cv/cv.store';
import { Shell } from '../../layout/shell/shell';
import { LoginPage } from '../auth/login.page';
import { MyCvPage } from './my-cv.page';

/** El texto exacto de la línea de privacidad (D13). Si cambia una coma, cambia la promesa. */
const PRIVACY_LINE =
  'Tu CV solo lo ves tú y hoy no lo lee ninguna IA. No saldrá de LinkVault sin tu autorización.';

export function cvDocument(overrides: Partial<CvDocument> = {}): CvDocument {
  return {
    id: 'cv1',
    fileName: 'CV_backend.pdf',
    fileType: 'pdf',
    sizeBytes: 319_488,
    version: 1,
    isDefault: true,
    uploadedAt: '2026-09-12T10:00:00.000Z',
    extraction: { status: 'extracted', textChars: 8_412, extractedAt: '2026-09-12T10:00:05.000Z' },
    ...overrides,
  };
}

describe('MyCvPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    stopPolling();
    TestBed.inject(MatDialog).closeAll();
    verifyNoPendingRequests(http);
  });

  /** Corta la ventana de sondeo de la página, para que ningún reloj vivo se cuele en el test siguiente. */
  function stopPolling(): void {
    harness.fixture.debugElement.query(By.directive(MyCvPage))?.injector.get(CvStore).stopPolling();
  }

  function pdf(name: string, size: number): File {
    const file = new File([''], name, { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  /** Los nombres de los CV que llevan la línea de la marca; debería haber como mucho uno. */
  function defaultNames(): string[] {
    return Array.from(page().querySelectorAll('[data-testid="cv-card"]'))
      .filter((card) => card.querySelector('[data-testid="cv-default-line"]') !== null)
      .map((card) => card.querySelector('[data-testid="cv-name"]')?.textContent?.split('·')[0].trim() ?? '');
  }

  /** Pulsa un botón de la pantalla; con `card` se busca dentro de la tarjeta que ocupa esa posición. */
  async function click(selector: string, card?: number): Promise<void> {
    const scope =
      card === undefined
        ? page()
        : (page().querySelectorAll('[data-testid="cv-card"]')[card] as HTMLElement | undefined);
    const button = scope?.querySelector<HTMLButtonElement>(selector);
    if (!button) {
      throw new Error(`Button "${selector}" not rendered`);
    }
    button.click();
    await settle();
    await harness.fixture.whenStable();
  }

  /** Elige un archivo en el selector de la pantalla, como haría el sistema operativo. */
  async function choose(file: File): Promise<void> {
    const input = page().querySelector<HTMLInputElement>('[data-testid="cv-file-input"]');
    if (!input) {
      throw new Error('File input not rendered');
    }
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    await harness.fixture.whenStable();
  }

  /** La página vive dentro del shell: se busca por su directiva, no por el elemento de la ruta. */
  function page(): HTMLElement {
    const debugElement = harness.fixture.debugElement.query(By.directive(MyCvPage));
    if (!debugElement) {
      throw new Error('MyCvPage not rendered');
    }
    return debugElement.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Entra en `/mi-cv` y responde a la carga de la lista con `items`. */
  async function open(items: CvDocument[]): Promise<void> {
    await harness.navigateByUrl('/mi-cv', Shell);
    const request = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/cv' }));
    request.flush({ items });
    await settle();
    await harness.fixture.whenStable();
  }

  it('Entrar sin CV', async () => {
    await open([]);

    expect(text()).toContain('Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante.');
    expect(text()).toContain(PRIVACY_LINE);
    expect(page().querySelectorAll('[data-testid="cv-card"]')).toHaveLength(0);
  });

  it('La promesa está donde se pide el dato', async () => {
    await open([]);

    const privacy = page().querySelector('[data-testid="cv-privacy"]');
    // Está en la página, no dentro de un diálogo, un acordeón ni un `details`: se lee sin abrir nada.
    expect(privacy?.textContent?.replace(/\s+/g, ' ').trim()).toBe(PRIVACY_LINE);
    expect(privacy?.closest('details, dialog, [hidden]')).toBeNull();
  });

  it('la línea de privacidad no promete un permiso ni nombra una pantalla que no existe', async () => {
    await open([]);

    const privacy = page().querySelector('[data-testid="cv-privacy"]')?.textContent ?? '';
    // Ni "te pediremos permiso" (el consentimiento es una preferencia que la pasarela lee sin preguntar) ni "Ajustes",
    // que es una pantalla que no existe; el control del perfil llega con `cv-match-suggestions` (ADR-028 §11).
    for (const forbidden of ['permiso', 'Ajustes', 'ajustes', 'Configuración', 'consentimiento']) {
      expect.soft(privacy).not.toContain(forbidden);
    }
  });

  it('Ruta con sesión', async () => {
    TestBed.inject(SessionStore).clear();

    const landed = await harness.navigateByUrl('/mi-cv', LoginPage);

    expect(landed).toBeInstanceOf(LoginPage);
    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Fmi-cv');
  });

  it('Subida con progreso', async () => {
    await open([]);

    await choose(pdf('CV_backend.pdf', 2 * 1024 * 1024));
    const request = http.expectOne({ method: 'POST', url: '/api/cv' });
    request.event({ type: HttpEventType.UploadProgress, loaded: 1024, total: 2048 });
    await settle();
    await harness.fixture.whenStable();
    expect(page().querySelector('[data-testid="cv-upload-progress"]')).not.toBeNull();

    request.flush(cvDocument({ extraction: { status: 'pending', textChars: 0 } }));
    await settle();
    await harness.fixture.whenStable();

    expect(page().querySelector('[data-testid="cv-upload-progress"]')).toBeNull();
    expect(http.match({ method: 'POST', url: '/api/cv' })).toHaveLength(0);
  });

  it('Tres CV guardados', async () => {
    await open([
      cvDocument({ id: 'cv3', fileName: 'CV_2026.pdf', version: 3, uploadedAt: '2026-09-12T10:00:00.000Z' }),
      cvDocument({
        id: 'cv2',
        fileName: 'CV_backend.docx',
        fileType: 'docx',
        version: 2,
        isDefault: false,
        uploadedAt: '2026-08-30T10:00:00.000Z',
      }),
      cvDocument({
        id: 'cv1',
        fileName: 'CV_viejo.pdf',
        version: 1,
        isDefault: false,
        uploadedAt: '2026-07-01T10:00:00.000Z',
      }),
    ]);

    const names = Array.from(page().querySelectorAll('[data-testid="cv-name"]')).map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(names).toEqual([
      'CV_2026.pdf · 312 KB · 12/09/2026',
      'CV_backend.docx · 312 KB · 30/08/2026',
      'CV_viejo.pdf · 312 KB · 01/07/2026',
    ]);
    // Ni número de versión ni recuento de caracteres.
    expect(text()).not.toContain('8.412');
    expect(text()).not.toContain('versión');
  });

  it('La marca explica su consecuencia', async () => {
    await open([cvDocument()]);

    const card = page().querySelector('[data-testid="cv-card"]');
    const children = Array.from(card?.children ?? []).map((child) => child.getAttribute('data-testid'));
    const line = card?.querySelector('[data-testid="cv-default-line"]');
    expect(line?.textContent?.trim()).toBe('Este es el CV que compararemos con las vacantes');
    // Bajo el nombre del archivo, como una línea de texto y no como un distintivo de dos palabras.
    expect(children.indexOf('cv-default-line')).toBe(children.indexOf('cv-name') + 1);
    expect(text()).not.toContain('Por defecto');
  });

  it('Cambiar de CV', async () => {
    const newest = cvDocument({ id: 'cv2', fileName: 'CV_nuevo.pdf', version: 2 });
    const older = cvDocument({ id: 'cv1', isDefault: false });
    await open([newest, older]);
    expect(defaultNames()).toEqual(['CV_nuevo.pdf']);

    await click('[data-testid="cv-use-this"]', 1);

    http.expectOne({ method: 'PUT', url: '/api/cv/cv1/default' }).flush({
      items: [{ ...newest, isDefault: false }, { ...older, isDefault: true }],
    });
    await settle();
    await harness.fixture.whenStable();

    expect(defaultNames()).toEqual(['CV_backend.pdf']);
  });

  it('La API falla al marcar', async () => {
    const newest = cvDocument({ id: 'cv2', fileName: 'CV_nuevo.pdf', version: 2 });
    await open([newest, cvDocument({ id: 'cv1', isDefault: false })]);

    await click('[data-testid="cv-use-this"]', 1);
    const { body, options } = apiError('internal_error', 500);
    http.expectOne({ method: 'PUT', url: '/api/cv/cv1/default' }).flush(body, options);
    await settle();
    await harness.fixture.whenStable();

    expect(defaultNames()).toEqual(['CV_nuevo.pdf']);
    expect(text()).toContain('Algo salió mal');
  });

  it('marca con una sola acción el CV que sí se leyó', async () => {
    const broken = cvDocument({
      id: 'cv2',
      fileName: 'CV_escaneado.pdf',
      version: 2,
      extraction: { status: 'failed', failureReason: 'no_text', textChars: 0 },
    });
    const readable = cvDocument({ id: 'cv1', isDefault: false });
    await open([broken, readable]);

    await click('[data-testid="cv-use-extracted"]', 0);

    http.expectOne({ method: 'PUT', url: '/api/cv/cv1/default' }).flush({
      items: [{ ...broken, isDefault: false }, { ...readable, isDefault: true }],
    });
    await settle();
    await harness.fixture.whenStable();

    expect(defaultNames()).toEqual(['CV_backend.pdf']);
    expect(page().querySelector('[data-testid="cv-default-useless"]')).toBeNull();
  });

  it('No se ofrece sin texto', async () => {
    await open([
      cvDocument({ id: 'cv2', version: 2, extraction: { status: 'pending', textChars: 0 } }),
      cvDocument({
        id: 'cv1',
        isDefault: false,
        extraction: { status: 'failed', failureReason: 'no_text', textChars: 0 },
      }),
    ]);

    expect(page().querySelectorAll('[data-testid="cv-view-text"]')).toHaveLength(0);
    stopPolling();
  });

  it('el diálogo del CV borrado en otra pestaña lo dice y recarga la lista', async () => {
    await open([cvDocument()]);

    await click('[data-testid="cv-view-text"]', 0);
    const { body, options } = apiError('cv_not_found', 404);
    http.expectOne({ method: 'GET', url: '/api/cv/cv1/text-preview' }).flush(body, options);
    await settle();
    await harness.fixture.whenStable();
    await settle();

    // El diálogo se cierra solo y la lista se vuelve a pedir; el aviso se queda en la pantalla.
    const reload = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/cv' }));
    reload.flush({ items: [] });
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Este CV ya no está');
    expect(page().querySelectorAll('[data-testid="cv-card"]')).toHaveLength(0);
  });

  it('La lista no carga', async () => {
    await harness.navigateByUrl('/mi-cv', Shell);
    const request = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/cv' }));
    const { body, options } = apiError('internal_error', 500);
    request.flush(body, options);
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Algo salió mal');
    page().querySelector<HTMLButtonElement>('[data-testid="cv-list-retry"]')?.click();
    await settle();

    http.expectOne({ method: 'GET', url: '/api/cv' }).flush({ items: [cvDocument()] });
    await settle();
    await harness.fixture.whenStable();
    expect(text()).not.toContain('Algo salió mal');
  });
});
