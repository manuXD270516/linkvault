import { HttpEventType } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
