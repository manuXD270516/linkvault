import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CvDocument } from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { CV_POLL_INTERVAL_MS, CV_POLL_WINDOW_MS, CvStore } from './cv.store';

function cv(overrides: Partial<CvDocument> = {}): CvDocument {
  return {
    id: 'cv1',
    fileName: 'CV_backend.pdf',
    fileType: 'pdf',
    sizeBytes: 319_488,
    version: 1,
    isDefault: true,
    uploadedAt: '2026-09-12T10:00:00.000Z',
    extraction: { status: 'pending', textChars: 0 },
    ...overrides,
  };
}

const pending = cv();
const extracted = cv({
  extraction: { status: 'extracted', textChars: 8_412, extractedAt: '2026-09-12T10:00:05.000Z' },
});

function pdf(): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'CV_backend.pdf', {
    type: 'application/pdf',
  });
}

describe('CvStore', () => {
  let http: HttpTestingController;
  let store: CvStore;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [...providePageTesting(), CvStore] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    store = TestBed.inject(CvStore);
  });

  afterEach(() => {
    store.stopPolling();
    verifyNoPendingRequests(http);
    vi.useRealTimers();
  });

  /** Responde a la petición de la lista y deja que las promesas que esperaban terminen. */
  async function flushList(items: CvDocument[]): Promise<void> {
    http.expectOne({ method: 'GET', url: '/api/cv' }).flush({ items });
    await vi.advanceTimersByTimeAsync(0);
  }

  /** Una vuelta del sondeo: pasan los 2 s y la API responde con `items`. */
  async function nextPoll(items: CvDocument[]): Promise<void> {
    await vi.advanceTimersByTimeAsync(CV_POLL_INTERVAL_MS);
    await flushList(items);
  }

  async function openWith(items: CvDocument[]): Promise<void> {
    const loading = store.load();
    await flushList(items);
    await loading;
  }

  it('carga la lista y distingue "no hay ninguno" de "no se ha pedido"', async () => {
    expect(store.loaded()).toBe(false);
    expect(store.isEmpty()).toBe(false);

    await openWith([]);

    expect(store.loaded()).toBe(true);
    expect(store.isEmpty()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('La lista no carga', async () => {
    const loading = store.load();
    const { body, options } = apiError('internal_error', 500);
    http.expectOne({ method: 'GET', url: '/api/cv' }).flush(body, options);
    await loading;

    expect(store.failure()).toEqual({
      kind: 'api',
      status: 500,
      code: 'internal_error',
      retryAfterMinutes: null,
    });

    const retry = store.refresh();
    await flushList([extracted]);
    await retry;

    expect(store.failure()).toBeNull();
    expect(store.items()).toEqual([extracted]);
  });

  it('La lectura termina', async () => {
    await openWith([pending]);
    expect(store.hasPending()).toBe(true);

    await nextPoll([extracted]);

    expect(store.items()).toEqual([extracted]);
    expect(store.hasPending()).toBe(false);
    expect(store.stalled()).toBe(false);
  });

  it('El sondeo se detiene', async () => {
    await openWith([extracted]);

    await vi.advanceTimersByTimeAsync(10_000);

    http.expectNone({ method: 'GET', url: '/api/cv' });
  });

  it('Se acabó la paciencia', async () => {
    await openWith([pending]);

    for (let poll = 0; poll < CV_POLL_WINDOW_MS / CV_POLL_INTERVAL_MS; poll += 1) {
      await nextPoll([pending]);
    }

    expect(store.stalled()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    http.expectNone({ method: 'GET', url: '/api/cv' });
  });

  it('Actualizar reanuda la espera', async () => {
    await openWith([pending]);
    for (let poll = 0; poll < CV_POLL_WINDOW_MS / CV_POLL_INTERVAL_MS; poll += 1) {
      await nextPoll([pending]);
    }
    expect(store.stalled()).toBe(true);

    const refreshing = store.refresh();
    await flushList([pending]);
    await refreshing;

    expect(store.stalled()).toBe(false);
    // La ventana vuelve a empezar: hay otras 30 vueltas antes del aviso.
    await nextPoll([pending]);
    expect(store.stalled()).toBe(false);
  });

  it('Salir de la pantalla', async () => {
    await openWith([pending]);
    // La ventana está abierta: hay un temporizador vivo pidiendo la lista cada 2 s.
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Destruir el inyector es lo que hace el router al salir de `/mi-cv`: el store lo provee la página.
    TestBed.resetTestingModule();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    http.expectNone({ method: 'GET', url: '/api/cv' });
  });

  it('un fallo del sondeo no borra la lista ni corta la ventana', async () => {
    await openWith([pending]);

    await vi.advanceTimersByTimeAsync(CV_POLL_INTERVAL_MS);
    const { body, options } = apiError('internal_error', 500);
    http.expectOne({ method: 'GET', url: '/api/cv' }).flush(body, options);
    await vi.advanceTimersByTimeAsync(0);

    expect(store.items()).toEqual([pending]);
    expect(store.failure()).toBeNull();

    await nextPoll([extracted]);
    expect(store.items()).toEqual([extracted]);
  });

  it('sube el CV con su progreso, lo pone arriba y se lleva la marca', async () => {
    await openWith([extracted]);
    const uploading = store.upload(pdf());

    const request = http.expectOne({ method: 'POST', url: '/api/cv' });
    request.event({ type: 1, loaded: 512, total: 2048 });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.uploading()).toBe(true);
    expect(store.uploadPercent()).toBe(25);

    request.flush(cv({ id: 'cv2', version: 2, fileName: 'CV_nuevo.pdf' }));
    await uploading;

    expect(store.items().map((item) => item.id)).toEqual(['cv2', 'cv1']);
    expect(store.items().map((item) => item.isDefault)).toEqual([true, false]);
    expect(store.uploading()).toBe(false);
    // El CV nuevo nace en `pending`, así que la ventana de sondeo se abre sola.
    await nextPoll([cv({ id: 'cv2', version: 2 })]);
  });

  it('guarda el fallo de la subida sin tocar la lista', async () => {
    await openWith([extracted]);

    const uploading = store.upload(pdf());
    const { body, options } = apiError('too_many_cvs', 409);
    http.expectOne({ method: 'POST', url: '/api/cv' }).flush(body, options);
    await uploading;

    expect(store.uploadFailure()).toMatchObject({ status: 409, code: 'too_many_cvs' });
    expect(store.items()).toEqual([extracted]);
  });

  it('no envía una segunda subida mientras hay una en curso', async () => {
    await openWith([]);
    const first = store.upload(pdf());

    await store.upload(pdf());

    const request = http.expectOne({ method: 'POST', url: '/api/cv' });
    request.flush(cv({ id: 'cv2', extraction: { status: 'extracted', textChars: 120 } }));
    await first;
  });

  it('mueve la marca y la devuelve si la API falla', async () => {
    const second = cv({ id: 'cv2', version: 2, isDefault: false });
    await openWith([second, extracted]);

    const marking = store.setDefault('cv2');
    expect(store.defaultCv()?.id).toBe('cv2');
    const { body, options } = apiError('internal_error', 500);
    http.expectOne({ method: 'PUT', url: '/api/cv/cv2/default' }).flush(body, options);
    await marking;

    expect(store.defaultCv()?.id).toBe('cv1');
    expect(store.actionFailure()).toMatchObject({ status: 500 });
  });

  it('elimina un CV y recarga la lista si ya no estaba', async () => {
    await openWith([extracted]);

    const removing = store.remove('cv1');
    const { body, options } = apiError('cv_not_found', 404);
    http.expectOne({ method: 'DELETE', url: '/api/cv/cv1' }).flush(body, options);
    await vi.advanceTimersByTimeAsync(0);
    await flushList([]);
    await removing;

    expect(store.items()).toEqual([]);
    expect(store.actionFailure()).toBeNull();
  });
});
