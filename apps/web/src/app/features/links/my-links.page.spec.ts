import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  JobLinkSummary,
  LinkPage,
  PublicPreviewResponse,
  SaveLinkResponse,
} from '@linkvault/shared';
import {
  apiError,
  buttonWithText,
  flushGroupsList,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { Shell } from '../../layout/shell/shell';
import { MyLinksPage } from './my-links.page';

const MINE_PAGE = '/api/links/mine?limit=20';

const priv: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://ejemplo.test/ofertas/analista-de-datos',
  displayUrl: 'https://ejemplo.test/ofertas/analista-de-datos',
  platform: 'generic',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedAt: '2026-09-17T10:00:00.000Z',
};

describe('MyLinksPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => verifyNoPendingRequests(http));

  function page(): HTMLElement {
    const debugElement = harness.fixture.debugElement.query(By.directive(MyLinksPage));
    if (!debugElement) {
      throw new Error('MyLinksPage not rendered');
    }
    return debugElement.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Entra en `/mis-links` y responde a la primera página de la lista privada. */
  async function openPage(items: JobLinkSummary[]): Promise<void> {
    await harness.navigateByUrl('/mis-links', Shell);
    const request = await vi.waitFor(() => http.expectOne(MINE_PAGE));
    request.flush({ items, total: items.length } satisfies LinkPage);
    await settle();
    await harness.fixture.whenStable();
  }

  it('Vista privada', async () => {
    await openPage([priv]);

    expect(text()).toContain('Solo para mí');
    expect(text()).toContain('analista de datos');
    expect(page().querySelectorAll('[data-testid="link-open"]')).toHaveLength(1);
  });

  it('Vista privada vacía', async () => {
    await openPage([]);

    expect(text()).toContain('Solo para mí');
    expect(text()).toContain('Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos.');
  });

  it('offers to save a link and to paste a chat', async () => {
    await openPage([]);

    expect(text()).toContain('Pega el enlace de una oferta');
    expect(text()).toContain('Pegar un chat');
  });

  describe('importing a public job', () => {
    const SLUG = 'k3m9qrtv2xyz';
    const PREVIEW_URL = `/api/public/previews/${SLUG}`;
    const PUBLIC_URL = 'https://ejemplo.test/ofertas/analista-de-datos';

    const preview: PublicPreviewResponse = {
      slug: SLUG,
      link: { platform: 'generic', displayUrl: PUBLIC_URL, title: 'Analista de datos' },
    };

    const saved: SaveLinkResponse = {
      link: priv,
      created: true,
      shared: 'created',
      alreadyInGroups: [],
    };

    /** Entra en `/mis-links?import=<slug>` y responde a la primera página de la lista privada. */
    async function openImporting(items: JobLinkSummary[] = []): Promise<void> {
      await harness.navigateByUrl(`/mis-links?import=${SLUG}`, Shell);
      const request = await vi.waitFor(() => http.expectOne(MINE_PAGE));
      request.flush({ items, total: items.length } satisfies LinkPage);
      await settle();
      await harness.fixture.whenStable();
    }

    /** Responde al preview público con `response` y, si lo hay, al guardado que viene detrás. */
    async function flushPreview(
      response: PublicPreviewResponse | { code: string; status: number },
    ): Promise<void> {
      const request = await vi.waitFor(() => http.expectOne(PREVIEW_URL));
      if ('code' in response) {
        const { body, options } = apiError(response.code, response.status);
        request.flush(body, options);
      } else {
        request.flush(response);
      }
      await settle();
      await harness.fixture.whenStable();
    }

    /** Responde al `POST /api/links` del import y a la recarga de la lista que lo sigue. */
    async function flushSave(response: SaveLinkResponse, items: JobLinkSummary[] = [priv]): Promise<void> {
      const save = await vi.waitFor(() => http.expectOne({ method: 'POST', url: '/api/links' }));
      expect(save.request.body).toEqual({ url: PUBLIC_URL });
      save.flush(response, { status: 201, statusText: 'Created' });
      const reload = await vi.waitFor(() => http.expectOne(MINE_PAGE));
      reload.flush({ items, total: items.length } satisfies LinkPage);
      await settle();
      await harness.fixture.whenStable();
    }

    function url(): string {
      return TestBed.inject(Router).url;
    }

    it('Oferta guardada', async () => {
      await openImporting();
      await flushPreview(preview);
      await flushSave(saved);

      expect(text()).toContain('Guardada en «Solo para mí». Compártela en un grupo cuando quieras.');
      expect(page().querySelectorAll('[data-testid="link-open"]')).toHaveLength(1);
      expect(url()).toBe('/mis-links');
    });

    it('Recargar no duplica', async () => {
      await openImporting();
      await flushPreview(preview);
      await flushSave(saved);

      // La URL ya no lleva el parámetro, así que volver a entrar no vuelve a leer ni a guardar nada.
      await harness.navigateByUrl('/grupos', Shell);
      await flushGroupsList(http);
      await harness.navigateByUrl('/mis-links', Shell);
      const request = await vi.waitFor(() => http.expectOne(MINE_PAGE));
      request.flush({ items: [priv], total: 1 } satisfies LinkPage);
      await settle();
      await harness.fixture.whenStable();

      http.expectNone(PREVIEW_URL);
      http.expectNone({ method: 'POST', url: '/api/links' });
      expect(page().querySelectorAll('[data-testid="link-open"]')).toHaveLength(1);
    });

    it('never sends a group when importing from a public link', async () => {
      await openImporting();
      await flushPreview(preview);

      const save = await vi.waitFor(() => http.expectOne({ method: 'POST', url: '/api/links' }));
      expect(save.request.body).toEqual({ url: PUBLIC_URL });
      expect(save.request.body).not.toHaveProperty('groupId');
      save.flush(saved, { status: 201, statusText: 'Created' });
      const reload = await vi.waitFor(() => http.expectOne(MINE_PAGE));
      reload.flush({ items: [priv], total: 1 } satisfies LinkPage);
      await settle();
    });

    it('reads the public preview only once per navigation', async () => {
      await openImporting();
      await flushPreview(preview);
      await flushSave(saved);

      http.expectNone(PREVIEW_URL);
    });

    it('does not import anything when the import is not a slug', async () => {
      await harness.navigateByUrl('/mis-links?import=..%2Fotra-cosa', Shell);
      const request = await vi.waitFor(() => http.expectOne(MINE_PAGE));
      request.flush({ items: [], total: 0 } satisfies LinkPage);
      await settle();

      http.expectNone(`/api/public/previews/..%2Fotra-cosa`);
      http.expectNone({ method: 'POST', url: '/api/links' });
      expect(page().querySelector('[data-testid="import-outcome"]')).toBeNull();
    });

    it('Enlace despublicado entre medias', async () => {
      await openImporting();
      await flushPreview({ code: 'link_not_found', status: 404 });

      expect(text()).toContain('Ese enlace ya no está disponible');
      expect(page().querySelector('[data-testid="import-retry"]')).toBeNull();
      expect(url()).toBe('/mis-links');
      http.expectNone({ method: 'POST', url: '/api/links' });
      expect(text()).toContain('Aquí guardas ofertas solo para ti');
    });

    it('La oferta no se pudo leer ahora', async () => {
      await openImporting();
      await flushPreview({ code: 'too_many_attempts', status: 429 });

      expect(text()).toContain('No pudimos leer la oferta ahora');
      expect(page().querySelector('[data-testid="import-retry"]')).not.toBeNull();
      expect(url()).toBe(`/mis-links?import=${SLUG}`);
    });

    it('keeps the import parameter after a server error too', async () => {
      await openImporting();
      await flushPreview({ code: 'internal_error', status: 500 });

      expect(text()).toContain('No pudimos leer la oferta ahora');
      expect(url()).toBe(`/mis-links?import=${SLUG}`);
    });

    it('retries the whole import after an outage', async () => {
      await openImporting();
      await flushPreview({ code: 'too_many_attempts', status: 429 });

      buttonWithText(page(), 'Reintentar').click();
      await settle();
      await flushPreview(preview);
      await flushSave(saved);

      expect(text()).toContain('Guardada en «Solo para mí»');
      expect(url()).toBe('/mis-links');
    });

    it('Ya la tenía', async () => {
      await openImporting();
      await flushPreview(preview);
      await flushSave({ ...saved, created: false, shared: 'already_there' });

      expect(text()).toContain('Ya la tenías guardada');
      expect(text()).not.toContain('Guardada en «Solo para mí»');
      expect(page().querySelectorAll('[data-testid="link-open"]')).toHaveLength(1);
    });

    it('Ya la tenía en un grupo', async () => {
      await openImporting();
      await flushPreview(preview);
      await flushSave({
        ...saved,
        created: false,
        shared: 'already_there',
        alreadyInGroups: [{ id: 'g1', name: 'Backend Bolivia' }],
      });

      expect(text()).toContain('Ya la tienes en: Backend Bolivia');
    });

    it('El guardado falla', async () => {
      await openImporting();
      await flushPreview(preview);
      const save = await vi.waitFor(() => http.expectOne({ method: 'POST', url: '/api/links' }));
      const { body, options } = apiError('internal_error', 500);
      save.flush(body, options);
      await settle();
      await harness.fixture.whenStable();

      expect(text()).toContain('No pudimos guardar esta oferta. Inténtalo de nuevo.');
      expect(text()).toContain('Aquí guardas ofertas solo para ti');

      // Reintentar guarda sin volver al enlace público: la URL ya se leyó.
      buttonWithText(page(), 'Reintentar').click();
      await settle();
      await flushSave(saved);

      expect(text()).toContain('Guardada en «Solo para mí»');
      http.expectNone(PREVIEW_URL);
    });

    it('treats a job whose URL cannot be published as a link that is gone', async () => {
      await openImporting();
      await flushPreview({ slug: SLUG, link: { platform: 'generic' } });

      expect(text()).toContain('Ese enlace ya no está disponible');
      http.expectNone({ method: 'POST', url: '/api/links' });
    });
  });

  it('does not show the empty state while the first page is loading', async () => {
    await harness.navigateByUrl('/mis-links', Shell);
    const request = await vi.waitFor(() => http.expectOne(MINE_PAGE));

    expect(text()).not.toContain('Aquí guardas ofertas solo para ti');

    request.flush({ items: [], total: 0 } satisfies LinkPage);
    await settle();
    await harness.fixture.whenStable();
  });
});
