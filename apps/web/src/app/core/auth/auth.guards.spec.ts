import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import { authGuard, guestGuard } from './auth.guards';
import { authInterceptor } from './auth.interceptor';
import { REFRESH_LOCKS } from './refresh-coordination';
import { safeReturnUrl } from './return-url';
import { SESSION_RESTORE_TIMEOUT_MS, provideSessionRestore } from './session-restore';
import { SessionStore } from './session.store';

const user: UserProfile = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  aiConsent: { externalProviders: false },
  outputLanguage: 'es',
  redactName: false,
  createdAt: '2026-09-17T10:00:00.000Z',
};

const session: SessionResponse = { accessToken: 'token-1', expiresIn: 900, user };

@Component({ selector: 'lv-home-stub', template: 'inicio' })
class HomeStub {}

@Component({ selector: 'lv-profile-stub', template: 'perfil' })
class ProfileStub {}

@Component({ selector: 'lv-login-stub', template: 'login' })
class LoginStub {}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Con relojes falsos, avanza de 10 en 10 ms (el planificador zoneless también usa `setTimeout`) hasta que `promise` termina. */
async function advanceUntil<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => (done = true));
  for (let elapsed = 0; !done && elapsed < 60_000; elapsed += 10) {
    await vi.advanceTimersByTimeAsync(10);
  }
  return tracked;
}

describe('session restore and guards', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: HomeStub, canActivate: [authGuard] },
          { path: 'perfil', component: ProfileStub, canActivate: [authGuard] },
          { path: 'login', component: LoginStub, canActivate: [guestGuard] },
        ]),
        provideSessionRestore(),
        { provide: REFRESH_LOCKS, useValue: null },
      ],
    });
  });

  /** Inicializa el entorno (y con él el initializer, que arranca el refresh). */
  function start(): void {
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(SessionStore);
  }

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('starts the refresh from the app initializer', async () => {
    start();
    await settle();

    const refresh = http.expectOne('/api/auth/refresh');
    expect(store.status()).toBe('unknown');
    refresh.flush(session);
    await settle();

    expect(store.status()).toBe('authenticated');
  });

  it('Recarga con sesión', async () => {
    start();
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/perfil');
    await settle();

    http.expectOne('/api/auth/refresh').flush(session);
    await navigation;

    expect(router.url).toBe('/perfil');
    expect(harness.routeNativeElement?.textContent).toContain('perfil');
    expect(store.user()).toEqual(user);
  });

  it('API sin respuesta al cargar', async () => {
    // Relojes falsos antes de arrancar: el temporizador de 10 s se crea en el initializer.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    const harness = await advanceUntil(RouterTestingHarness.create());
    const refresh = http.expectOne('/api/auth/refresh');
    let navigated = false;
    const navigation = harness.navigateByUrl('/').then(() => (navigated = true));

    await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS - 100);
    expect(refresh.cancelled).toBe(false);
    expect(navigated).toBe(false);
    await advanceUntil(navigation);

    expect(SESSION_RESTORE_TIMEOUT_MS).toBe(10_000);
    expect(refresh.cancelled).toBe(true);
    expect(router.url).toBe('/login');
    expect(store.status()).toBe('anonymous');
    await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS);
    http.expectNone('/api/auth/refresh');
    http.expectNone('/api/auth/logout');
  });

  it('continues without a session when the refresh is rejected, without logging out', async () => {
    start();
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/perfil');
    await settle();

    http
      .expectOne('/api/auth/refresh')
      .flush(
        { code: 'invalid_refresh', message: 'Invalid refresh' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await navigation;

    expect(router.url).toBe('/login?returnUrl=%2Fperfil');
    http.expectNone('/api/auth/logout');
  });

  it('Ruta protegida sin sesión', async () => {
    start();
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/');
    await settle();

    http
      .expectOne('/api/auth/refresh')
      .flush(
        { code: 'invalid_refresh', message: 'Invalid refresh' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await navigation;

    expect(router.url).toBe('/login');
    expect(harness.routeNativeElement?.textContent).toContain('login');
  });

  it('Página de invitado con sesión', async () => {
    start();
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/login');
    await settle();

    http.expectOne('/api/auth/refresh').flush(session);
    await navigation;

    expect(router.url).toBe('/');
    expect(harness.routeNativeElement?.textContent).toContain('inicio');
  });

  it('Ruta de retorno externa', async () => {
    start();
    const harness = await RouterTestingHarness.create();
    const firstVisit = harness.navigateByUrl('/login');
    await settle();
    http
      .expectOne('/api/auth/refresh')
      .flush(
        { code: 'invalid_refresh', message: 'Invalid refresh' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await firstVisit;

    for (const returnUrl of ['//evil.example', '/\\evil.example']) {
      store.clear();
      await harness.navigateByUrl(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      const requested = router.parseUrl(router.url).queryParamMap.get('returnUrl');
      expect(requested).toBe(returnUrl);

      // Lo que hará la página de login (7.6) tras una respuesta correcta.
      store.setSession(session);
      await router.navigateByUrl(safeReturnUrl(requested));

      expect(router.url).toBe('/');
    }
  });
});

describe('safeReturnUrl', () => {
  it('keeps internal routes', () => {
    expect(safeReturnUrl('/perfil')).toBe('/perfil');
    expect(safeReturnUrl('/grupos/1?tab=links#top')).toBe('/grupos/1?tab=links#top');
  });

  it('falls back to / for missing, external or ambiguous routes', () => {
    for (const returnUrl of [
      null,
      undefined,
      '',
      'perfil',
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/\t/evil.example',
      '/\n/evil.example',
    ]) {
      expect(safeReturnUrl(returnUrl)).toBe('/');
    }
  });
});
