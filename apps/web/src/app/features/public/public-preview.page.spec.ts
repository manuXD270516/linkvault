import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { PublicJobPreview, PublicPreviewResponse } from '@linkvault/shared';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { PublicPreviewPage } from './public-preview.page';
import robots from '../../../../public/robots.txt' with { loader: 'text' };

const SLUG = 'k3m9qrtv2xyz';
const PREVIEW_URL = `/api/public/previews/${SLUG}`;

const full: PublicJobPreview = {
  platform: 'linkedin',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  title: 'Backend Node.js',
  company: 'Acme',
  location: 'La Paz',
  modality: 'remote',
  seniority: 'senior',
  salary: { min: 8000, max: 12000, currency: 'BOB', period: 'month' },
  postedAt: '2026-09-18',
  expiresAt: '2026-10-31',
};

/** Un link recién compartido cuya oferta todavía no se ha leído: solo plataforma y URL. */
const unread: PublicJobPreview = {
  platform: 'generic',
  displayUrl: 'https://ejemplo.test/ofertas/analista-de-datos',
};

describe('PublicPreviewPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => verifyNoPendingRequests(http));

  function page(): HTMLElement {
    const debugElement = harness.fixture.debugElement.query(By.directive(PublicPreviewPage));
    if (!debugElement) {
      throw new Error('PublicPreviewPage not rendered');
    }
    return debugElement.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** Abre `/oferta/:slug` y responde al preview público con `link`. */
  async function openWith(link: PublicJobPreview): Promise<void> {
    const navigation = harness.navigateByUrl(`/oferta/${SLUG}`);
    const request = await vi.waitFor(() => http.expectOne(PREVIEW_URL));
    request.flush({ slug: SLUG, link } satisfies PublicPreviewResponse);
    await navigation;
    await settle();
    await harness.fixture.whenStable();
  }

  /** Abre `/oferta/:slug` y responde al preview público con un error. */
  async function openFailing(code: string, status: number): Promise<void> {
    const navigation = harness.navigateByUrl(`/oferta/${SLUG}`);
    const request = await vi.waitFor(() => http.expectOne(PREVIEW_URL));
    const { body, options } = apiError(code, status);
    request.flush(body, options);
    await navigation;
    await settle();
    await harness.fixture.whenStable();
  }

  /**
   * Pulsa el CTA y deja que `guestGuard` resuelva la sesión, que es donde se resuelve: sin cookie de refresh la
   * navegación acaba en `/registro`. El clic no espera a esa petición, que es justo lo que comprueba "El CTA no
   * espera a la API".
   */
  async function clickSave(): Promise<void> {
    buttonWithText(page(), 'Guardar en LinkVault').click();
    await settle();
    const refresh = await vi.waitFor(() => http.expectOne('/api/auth/refresh'));
    const { body, options } = apiError('invalid_refresh', 401);
    refresh.flush(body, options);
    await settle();
    await harness.fixture.whenStable();
  }

  it('Oferta pública con datos', async () => {
    await openWith(full);

    expect(text()).toContain('Backend Node.js');
    expect(text()).toContain('Acme');
    expect(text()).toContain('La Paz');
    expect(text()).toContain('Remoto');
    expect(text()).toContain('Senior');
    expect(text()).toContain('8.000 – 12.000 BOB al mes');
    expect(text()).toContain('Cierra el 31/10/2026');
    expect(text()).toContain('Ver la oferta original');
  });

  it('never shows a person or a group', async () => {
    await openWith(full);

    expect(text()).not.toContain('Ana');
    expect(text()).not.toContain('Backend Bolivia');
    expect(text()).not.toContain('Compartido por');
    expect(text()).not.toContain('Nota de');
    expect(text()).not.toContain('Comentar');
  });

  it('opens the original posting in another tab without leaking the referrer', async () => {
    await openWith(full);

    const original = page().querySelector<HTMLAnchorElement>('[data-testid="public-original"]');
    expect(original?.getAttribute('href')).toBe(full.displayUrl);
    expect(original?.getAttribute('target')).toBe('_blank');
    expect(original?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('Oferta pública sin preview', async () => {
    await openWith(unread);

    expect(text()).toContain('analista de datos');
    expect(text()).toContain('Ver la oferta original');
  });

  it('shows the job without the original link when the URL cannot be published', async () => {
    await openWith({ platform: 'generic' });

    expect(page().querySelector('[data-testid="public-original"]')).toBeNull();
    expect(page().querySelector('[data-testid="public-preview"]')).not.toBeNull();
  });

  it('La vista pública no pide la sesión', async () => {
    const navigation = harness.navigateByUrl(`/oferta/${SLUG}`);
    const request = await vi.waitFor(() => http.expectOne(PREVIEW_URL));

    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ slug: SLUG, link: full } satisfies PublicPreviewResponse);
    await navigation;
    await settle();

    // Ninguna otra petición: ni el refresh de la sesión, ni la lista de grupos, ni los estados de postulaciones.
    http.verify();
  });

  it('asks for the preview of the slug in the URL', async () => {
    const navigation = harness.navigateByUrl('/oferta/otro-slug-aqui');
    const request = await vi.waitFor(() =>
      http.expectOne('/api/public/previews/otro-slug-aqui'),
    );
    request.flush({ slug: SLUG, link: full } satisfies PublicPreviewResponse);
    await navigation;
    await settle();
  });

  it('shows a loading notice while the preview is in flight', async () => {
    const navigation = harness.navigateByUrl(`/oferta/${SLUG}`);
    const request = await vi.waitFor(() => http.expectOne(PREVIEW_URL));
    await harness.fixture.whenStable();

    expect(text()).toContain('Cargando la oferta');

    request.flush({ slug: SLUG, link: full } satisfies PublicPreviewResponse);
    await navigation;
    await settle();
  });

  it('does not render the job when the link is gone', async () => {
    await openFailing('link_not_found', 404);

    expect(page().querySelector('[data-testid="public-preview"]')).toBeNull();
  });

  it('Enlace que ya no está', async () => {
    await openFailing('link_not_found', 404);

    expect(text()).toContain('Este enlace ya no está disponible');
    expect(text()).toContain('Pídeselo de nuevo a quien te lo envió');
    expect(text()).not.toContain('Guardar en LinkVault');
    expect(page().querySelector('[data-testid="public-register"]')).not.toBeNull();
    expect(page().querySelector('[data-testid="public-login"]')).not.toBeNull();
  });

  it('La vista pública no se indexa', async () => {
    await openWith(full);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
  });

  it('takes the noindex away when the public view closes', async () => {
    await openWith(full);
    expect(document.querySelector('meta[name="robots"]')).not.toBeNull();

    // Salir de la vista (aquí, destruirla) quita la etiqueta: el resto del SPA no va con `noindex`.
    harness.fixture.destroy();
    await settle();

    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('Límite alcanzado', async () => {
    await openFailing('too_many_attempts', 429);

    expect(text()).toContain('Ahora mismo no podemos mostrar esta oferta. Inténtalo en un momento.');
    expect(text()).toContain('Reintentar');
    expect(text()).toContain('Guardar en LinkVault');
    expect(text()).not.toContain('Este enlace ya no está disponible');
  });

  it('Error del servidor', async () => {
    await openFailing('internal_error', 500);

    expect(text()).toContain('Ahora mismo no podemos mostrar esta oferta. Inténtalo en un momento.');
    expect(text()).toContain('Reintentar');
    expect(text()).toContain('Guardar en LinkVault');
  });

  it('treats a network failure like an outage, not like a dead link', async () => {
    const navigation = harness.navigateByUrl(`/oferta/${SLUG}`);
    const request = await vi.waitFor(() => http.expectOne(PREVIEW_URL));
    request.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await navigation;
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Ahora mismo no podemos mostrar esta oferta');
    expect(text()).not.toContain('Este enlace ya no está disponible');
  });

  it('Reintentar funciona', async () => {
    await openFailing('too_many_attempts', 429);

    buttonWithText(page(), 'Reintentar').click();
    const retry = await vi.waitFor(() => http.expectOne(PREVIEW_URL));
    retry.flush({ slug: SLUG, link: full } satisfies PublicPreviewResponse);
    await settle();
    await harness.fixture.whenStable();

    expect(text()).toContain('Backend Node.js');
    expect(text()).not.toContain('Ahora mismo no podemos mostrar esta oferta');
  });

  it('Guardar pese a la avería', async () => {
    await openFailing('too_many_attempts', 429);

    await clickSave();

    expect(TestBed.inject(Router).url).toBe(`/registro?import=${SLUG}`);
  });

  it('Sin cuenta', async () => {
    await openWith(full);

    await clickSave();

    expect(TestBed.inject(Router).url).toBe(`/registro?import=${SLUG}`);
  });

  it('El CTA dice para qué sirve', async () => {
    await openWith(full);

    expect(text()).toContain('Guardar en LinkVault');
    expect(text()).toContain('Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas.');
    expect(text()).toContain('Entrar');
  });

  it('El CTA no espera a la API', async () => {
    await openWith(full);

    buttonWithText(page(), 'Guardar en LinkVault').click();
    await settle();

    // La navegación ya está en curso con el refresh del guard todavía sin responder: el clic no esperó a ninguna
    // petición, y quien decide el destino es el guard.
    const refresh = http.expectOne('/api/auth/refresh');
    expect(refresh.cancelled).toBe(false);
    const { body, options } = apiError('invalid_refresh', 401);
    refresh.flush(body, options);
    await settle();

    expect(TestBed.inject(Router).url).toBe(`/registro?import=${SLUG}`);
  });

  it('Con sesión abierta', async () => {
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    await openWith(full);

    buttonWithText(page(), 'Guardar en LinkVault').click();
    await settle();
    const list = await vi.waitFor(() => http.expectOne('/api/links/mine?limit=20'));
    list.flush({ items: [], total: 0 });
    await settle();

    // Pasa por `/registro?import=` sin verlo: `guestGuard` lo desvía.
    expect(TestBed.inject(Router).url).toBe(`/mis-links?import=${SLUG}`);
  });

  it('Doble pulsación del CTA', async () => {
    await openWith(full);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');

    // Con el guard restaurando la sesión, el botón se ve pendiente y la segunda pulsación no inicia otra navegación.
    const cta = buttonWithText(page(), 'Guardar en LinkVault');
    cta.click();
    await settle();
    harness.detectChanges();
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute('aria-busy')).toBe('true');
    cta.click();
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);

    const refresh = http.expectOne('/api/auth/refresh');
    const { body, options } = apiError('invalid_refresh', 401);
    refresh.flush(body, options);
    await settle();

    expect(router.url).toBe(`/registro?import=${SLUG}`);
  });

  it('does not offer to save when the link is gone', async () => {
    await openFailing('link_not_found', 404);

    expect(page().querySelector('[data-testid="public-cta"]')).toBeNull();
  });

  it('marks the public view as noindex also when the link is gone', async () => {
    await openFailing('link_not_found', 404);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
  });
});

describe('robots.txt del SPA', () => {
  it('La vista pública no se indexa', () => {
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Disallow: /oferta/');
    // `/p/` NO se desautoriza: los crawlers de las tarjetas sí respetan `robots.txt` y los enlaces se quedarían pelados.
    expect(robots).not.toContain('Disallow: /p/');
  });
});
