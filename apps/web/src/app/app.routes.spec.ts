import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type Route, Router, provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SessionResponse } from '@linkvault/shared';
import { appRoutes } from './app.routes';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { authInterceptor } from './core/auth/auth.interceptor';
import { SessionStore } from './core/auth/session.store';
import { LoginPage } from './features/auth/login.page';
import { RegisterPage } from './features/auth/register.page';
import { HomePage } from './features/home/home.page';
import { ProfilePage } from './features/profile/profile.page';
import { Shell } from './layout/shell/shell';

const session: SessionResponse = {
  accessToken: 'token-1',
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'ana@example.com',
    displayName: 'Ana',
    aiConsent: { externalProviders: false },
    outputLanguage: 'es',
    redactName: false,
    createdAt: '2026-09-17T10:00:00.000Z',
  },
};

function routeAt(path: string, routes: Route[] | undefined = appRoutes): Route {
  const route = routes?.find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`Route "${path}" not found`);
  }
  return route;
}

describe('appRoutes', () => {
  it('loads every page lazily', () => {
    const shell = routeAt('');
    const routes = [routeAt('login'), routeAt('registro'), shell, ...(shell.children ?? [])];

    expect(routes).toHaveLength(5);
    for (const route of routes) {
      expect(route.component).toBeUndefined();
      expect(route.loadComponent).toBeTypeOf('function');
    }
  });

  it('applies guestGuard to /login and /registro and authGuard to the shell', () => {
    const shell = routeAt('');

    expect(routeAt('login').canActivate).toEqual([guestGuard]);
    expect(routeAt('registro').canActivate).toEqual([guestGuard]);
    expect(shell.canActivate).toEqual([authGuard]);
    expect(routeAt('perfil', shell.children).canActivate).toBeUndefined();
  });

  describe('navigation', () => {
    let http: HttpTestingController;
    let router: Router;
    let store: SessionStore;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          provideHttpClient(withInterceptors([authInterceptor])),
          provideHttpClientTesting(),
          provideRouter(appRoutes),
        ],
      });
      http = TestBed.inject(HttpTestingController);
      router = TestBed.inject(Router);
      store = TestBed.inject(SessionStore);
    });

    afterEach(() => http.verify());

    it('shows the home page inside the shell with a session', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/', Shell);

      expect(harness.fixture.debugElement.query(By.directive(HomePage))).not.toBeNull();
      expect(harness.routeNativeElement?.textContent).toContain('Hola, Ana');
    });

    it('shows the profile page inside the shell with a session', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/perfil', Shell);

      expect(harness.fixture.debugElement.query(By.directive(ProfilePage))).not.toBeNull();
      expect(harness.routeNativeElement?.textContent).toContain('Cerrar sesión');
    });

    it('redirects a protected route without a session to /login with the requested route', async () => {
      store.clear();
      const harness = await RouterTestingHarness.create();

      const page = await harness.navigateByUrl('/perfil', LoginPage);

      expect(page).toBeInstanceOf(LoginPage);
      expect(router.url).toBe('/login?returnUrl=%2Fperfil');
    });

    it('shows /registro without a session', async () => {
      store.clear();
      const harness = await RouterTestingHarness.create();

      const page = await harness.navigateByUrl('/registro', RegisterPage);

      expect(page).toBeInstanceOf(RegisterPage);
    });

    it('redirects /registro to / with a session', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/registro', Shell);

      expect(harness.fixture.debugElement.query(By.directive(HomePage))).not.toBeNull();
      expect(router.url).toBe('/');
    });

    it('redirects unknown routes to /', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/no-existe');

      expect(router.url).toBe('/');
    });
  });
});
