import { HttpEventType } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AI_CONSENT_TEXT_VERSION, type CvDocument } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { CvStore } from '../../core/cv/cv.store';
import { Shell } from '../../layout/shell/shell';
import { LoginPage } from '../auth/login.page';
import { MyCvPage } from './my-cv.page';

/** Línea base de privacidad (ADR-030 §12, id nuevo). */
const PRIVACY_LINE =
  'Tu CV solo lo ves tú y no sale de LinkVault sin tu permiso. En Perfil decides si un proveedor de IA externo puede analizarlo: antes de enviárselo sustituimos tu email, tus teléfonos, tu dirección, tu documento de identidad y las URL por marcadores, y también tu nombre, salvo que lo desactives allí.';

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
    matchAnalysesCount: 0,
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

  /** Mensaje de la confirmación abierta, sin título ni botones. */
  function dialogMessage(): string {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container.querySelector('mat-dialog-content p')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Pulsa un botón de la confirmación abierta. */
  async function answer(label: string): Promise<void> {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    const button = Array.from(container?.querySelectorAll('button') ?? []).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) {
      throw new Error(`Button "${label}" not in the dialog`);
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
    expect(privacy?.textContent?.replace(/\s+/g, ' ').trim()).toBe(PRIVACY_LINE);
    expect(privacy?.closest('details, dialog, [hidden]')).toBeNull();
  });

  it('La autorización tiene dónde darse', async () => {
    await open([]);
    const link = page().querySelector<HTMLAnchorElement>('[data-testid="cv-privacy-profile-link"]');
    expect(link?.getAttribute('href')).toBe('/perfil');
  });

  it('Enlace a /privacidad visible en /mi-cv', async () => {
    await open([]);
    const link = page().querySelector<HTMLAnchorElement>('[data-testid="cv-privacy-notice-link"]');
    expect(link?.getAttribute('href')).toBe('/privacidad');
    expect(page().querySelector('[data-testid="cv-privacy-storage"]')?.textContent).toMatch(
      /almacenamiento|retención/i,
    );
  });

  it('La línea no inventa cifrado ni caducidad en el texto corto', async () => {
    await open([]);
    const short = page().querySelector('[data-testid="cv-privacy"]')?.textContent ?? '';
    expect(short).not.toMatch(/cifrado|SSE|caduca/i);
  });

  it('La línea del nombre dice lo que el sistema hace', async () => {
    await open([]);
    const privacy = page().querySelector('[data-testid="cv-privacy"]')?.textContent ?? '';
    expect(privacy).toMatch(/salvo que lo desactives/);
    expect(privacy).not.toMatch(/si lo activas/);
  });

  it('Sin permiso, la línea lo dice', async () => {
    await open([]);
    expect(page().querySelector('[data-testid="cv-privacy-status"]')?.textContent).toContain(
      'Ahora mismo no has dado ese permiso, así que tu CV no sale de LinkVault.',
    );
  });

  it('Con el permiso vigente, la línea dice la consecuencia', async () => {
    TestBed.inject(SessionStore).setUser({
      ...testUser,
      aiConsent: {
        externalProviders: true,
        consentedAt: '2026-09-21T12:00:00.000Z',
        textVersion: AI_CONSENT_TEXT_VERSION,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
    });
    await open([]);
    expect(page().querySelector('[data-testid="cv-privacy-status"]')?.textContent).toContain(
      'tu CV redactado sale de LinkVault hacia el proveedor externo',
    );
  });

  it('Con el permiso caducado, las dos pantallas dicen lo mismo', async () => {
    TestBed.inject(SessionStore).setUser({
      ...testUser,
      aiConsent: {
        externalProviders: true,
        consentedAt: '2026-01-01T00:00:00.000Z',
        textVersion: '2026-01-01',
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
    });
    await open([]);
    const status = page().querySelector('[data-testid="cv-privacy-status"]')?.textContent ?? '';
    expect(status).toContain('Diste este permiso, pero el texto cambió');
    expect(status).not.toMatch(/está activo/);
  });

  it('Sin conocer el permiso no se afirma nada', async () => {
    const store = TestBed.inject(SessionStore);
    store.setSession(sessionWith('token-1'));
    const reload = store.reloadConsent();
    await settle();
    http
      .expectOne('/api/users/me')
      .flush({ code: 'internal_error' }, { status: 500, statusText: 'Error' });
    await reload;
    expect(store.consentIsCurrent()).toBe('unknown');

    await harness.navigateByUrl('/mi-cv', Shell);
    const list = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/cv' }));
    list.flush({ items: [] });
    await settle();
    expect(page().querySelector('[data-testid="cv-privacy"]')).not.toBeNull();
    expect(page().querySelector('[data-testid="cv-privacy-status"]')).toBeNull();
  });

  it('La línea no promete lo que no hacemos', async () => {
    await open([]);
    const privacy = page().querySelector('[data-testid="cv-privacy"]')?.textContent ?? '';
    expect(privacy).not.toMatch(/te pediremos permiso|anónim|cifrado|caduca solo/i);
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

  it('Eliminar un CV', async () => {
    const newest = cvDocument({ id: 'cv2', fileName: 'CV_nuevo.pdf', version: 2 });
    await open([newest, cvDocument({ id: 'cv1', isDefault: false })]);

    await click('[data-testid="cv-remove"]', 1);

    expect(dialogMessage()).toBe(
      '¿Eliminar CV_backend.pdf? El archivo se borra y no se puede recuperar.',
    );
    await answer('Eliminar');

    const request = await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: '/api/cv/cv1' }));
    request.flush({ items: [newest] });
    await settle();
    await harness.fixture.whenStable();

    expect(page().querySelectorAll('[data-testid="cv-card"]')).toHaveLength(1);
  });

  it('Borrar el CV se lleva sus análisis y lo dice', async () => {
    await open([cvDocument({ matchAnalysesCount: 3 })]);
    await click('[data-testid="cv-remove"]', 0);
    expect(dialogMessage()).toContain(
      'También se borrarán los 3 análisis de encaje que hiciste con este CV.',
    );
    await answer('Cancelar');
  });

  it('Un CV sin análisis no anuncia ninguno', async () => {
    await open([cvDocument({ matchAnalysesCount: 0 })]);
    await click('[data-testid="cv-remove"]', 0);
    expect(dialogMessage()).not.toMatch(/análisis de encaje/);
    await answer('Cancelar');
  });

  it('Eliminar el marcado', async () => {
    const newest = cvDocument({ id: 'cv2', fileName: 'CV_nuevo.pdf', version: 2 });
    const older = cvDocument({ id: 'cv1', isDefault: false });
    await open([newest, older]);

    await click('[data-testid="cv-remove"]', 0);

    expect(dialogMessage()).toBe(
      '¿Eliminar CV_nuevo.pdf? El archivo se borra y no se puede recuperar. Pasará a usarse tu CV más reciente.',
    );
    await answer('Eliminar');

    const request = await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: '/api/cv/cv2' }));
    request.flush({ items: [{ ...older, isDefault: true }] });
    await settle();
    await harness.fixture.whenStable();

    expect(defaultNames()).toEqual(['CV_backend.pdf']);
  });

  it('Cancelar el borrado', async () => {
    await open([cvDocument()]);

    await click('[data-testid="cv-remove"]', 0);
    await answer('Cancelar');
    await settle();

    expect(page().querySelectorAll('[data-testid="cv-card"]')).toHaveLength(1);
    http.expectNone({ method: 'DELETE', url: '/api/cv/cv1' });
  });

  it('La API rechaza lo que el SPA dejó pasar', async () => {
    await open([cvDocument()]);

    // El archivo pasa la comprobación local: tiene extensión `.pdf` y pesa menos de 5 MB.
    await choose(pdf('CV_falso.pdf', 1024));
    const { body, options } = apiError('unsupported_file_type', 415);
    http.expectOne({ method: 'POST', url: '/api/cv' }).flush(body, options);
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Solo aceptamos PDF o DOCX');
    expect(page().querySelectorAll('[data-testid="cv-card"]')).toHaveLength(1);
  });

  it('el tamaño lo puede decir también la API', async () => {
    await open([]);

    await choose(pdf('CV_grande.pdf', 1024));
    const { body, options } = apiError('file_too_large', 413);
    http.expectOne({ method: 'POST', url: '/api/cv' }).flush(body, options);
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Ese archivo pesa más de 5 MB');
  });

  it('Tope de CV guardados', async () => {
    await open([cvDocument()]);

    await choose(pdf('CV_sexto.pdf', 1024));
    const { body, options } = apiError('too_many_cvs', 409);
    http.expectOne({ method: 'POST', url: '/api/cv' }).flush(body, options);
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain(
      'Guardamos hasta 5 CV. Elimina uno para subir otro; si alguno no se pudo leer, empieza por ese.',
    );
  });

  it('Límite alcanzado', async () => {
    await open([cvDocument()]);

    await choose(pdf('CV_backend.pdf', 1024));
    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '900' });
    http.expectOne({ method: 'POST', url: '/api/cv' }).flush(body, options);
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Demasiados intentos. Vuelve a intentarlo en 15 minutos');
    expect(page().querySelectorAll('[data-testid="cv-card"]')).toHaveLength(1);
  });

  it('Archivo que no admitimos, detectado en el SPA', async () => {
    await open([]);

    const odt = new File([''], 'CV_Ana.odt', { type: 'application/vnd.oasis.opendocument.text' });
    await choose(odt);

    expect(text()).toContain('Solo aceptamos PDF o DOCX');
    http.expectNone({ method: 'POST', url: '/api/cv' });
  });

  it('Archivo demasiado grande, detectado en el SPA', async () => {
    await open([]);

    await choose(pdf('CV_enorme.pdf', 7 * 1024 * 1024));

    expect(text()).toContain('Ese archivo pesa más de 5 MB');
    http.expectNone({ method: 'POST', url: '/api/cv' });
  });

  it('Se acabó la paciencia', async () => {
    const reading = cvDocument({ extraction: { status: 'pending', textChars: 0 } });

    // El reloj falso se instala antes de entrar: solo captura los temporizadores creados después.
    vi.useFakeTimers();
    try {
      await harness.navigateByUrl('/mi-cv', Shell);
      const first = await vi.waitFor(() => http.expectOne({ method: 'GET', url: '/api/cv' }));
      first.flush({ items: [reading] });
      await vi.advanceTimersByTimeAsync(0);

      // Se agota la ventana de sondeo —30 vueltas de 2 s— sin que la lectura termine.
      for (let poll = 0; poll < 30; poll += 1) {
        await vi.advanceTimersByTimeAsync(2_000);
        http.expectOne({ method: 'GET', url: '/api/cv' }).flush({ items: [reading] });
        await vi.advanceTimersByTimeAsync(0);
      }
    } finally {
      vi.useRealTimers();
    }
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain(
      'Sigue en proceso. Si sigue así en unos minutos, elimínalo y vuelve a subirlo.',
    );

    // "Actualizar" vuelve a pedir la lista y reanuda la espera.
    await click('[data-testid="cv-stalled-refresh"]');
    http.expectOne({ method: 'GET', url: '/api/cv' }).flush({ items: [cvDocument()] });
    await settle();
    await harness.fixture.whenStable();

    expect(text()).not.toContain('Sigue en proceso');
  });

  it('ninguna acción de la pantalla se llama "Descargar"', async () => {
    await open([cvDocument(), cvDocument({ id: 'cv0', version: 0 + 1, isDefault: false })]);

    const labels = Array.from(page().querySelectorAll('button, a')).map(
      (element) => element.textContent?.trim() ?? '',
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // La API no expone los bytes del archivo, así que la pantalla no puede ofrecer sacarlos de aquí.
      expect.soft(label).not.toMatch(/descargar|download|compartir|abrir el archivo/i);
    }
    expect(page().querySelectorAll('[download]')).toHaveLength(0);
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
