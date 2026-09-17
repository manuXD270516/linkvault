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
import { flushGroupDetail } from '../testing/auth-testing';
import { appRoutes } from './app.routes';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { authInterceptor } from './core/auth/auth.interceptor';
import { SessionStore } from './core/auth/session.store';
import { HOME_ROUTE } from './core/navigation/home-route';
import { LoginPage } from './features/auth/login.page';
import { RegisterPage } from './features/auth/register.page';
import { GroupDetailPage } from './features/groups/group-detail.page';
import { GroupsListPage } from './features/groups/groups-list.page';
import { JoinGroupPage } from './features/groups/join-group.page';
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
    const pages = [routeAt('login'), routeAt('registro'), shell, ...(shell.children ?? [])].filter(
      (route) => route.redirectTo === undefined,
    );

    // login, registro, el shell y sus cuatro páginas: /grupos, /grupos/:id, /unirse y /perfil.
    expect(pages).toHaveLength(7);
    for (const route of pages) {
      expect(route.component).toBeUndefined();
      expect(route.loadComponent).toBeTypeOf('function');
    }
  });

  it('redirects the empty route and the unknown ones to the home route', () => {
    const shell = routeAt('');

    expect(routeAt('', shell.children).redirectTo).toBe(HOME_ROUTE);
    expect(routeAt('**').redirectTo).toBe(HOME_ROUTE);
    expect(HOME_ROUTE).toBe('/grupos');
  });

  it('applies guestGuard to /login and /registro and authGuard to the shell', () => {
    const shell = routeAt('');

    expect(routeAt('login').canActivate).toEqual([guestGuard]);
    expect(routeAt('registro').canActivate).toEqual([guestGuard]);
    expect(shell.canActivate).toEqual([authGuard]);
    for (const path of ['grupos', 'grupos/:id', 'unirse', 'perfil']) {
      expect(routeAt(path, shell.children).canActivate).toBeUndefined();
    }
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

    it('redirects / to the group list inside the shell with a session', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/', Shell);
      // La lista se pide al entrar (7.3); aquí solo interesa la ruta.
      http.expectOne('/api/groups').flush([]);

      expect(harness.fixture.debugElement.query(By.directive(GroupsListPage))).not.toBeNull();
      expect(router.url).toBe('/grupos');
    });

    it('shows the group detail and the join page inside the shell with a session', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/grupos/g1', Shell);
      // El detalle pide el grupo y sus miembros al entrar (7.6); aquí solo interesa la ruta.
      await flushGroupDetail(http, {
        id: 'g1',
        name: 'Backend Bolivia',
        role: 'member',
        memberCount: 1,
        createdAt: '2026-09-17T12:00:00.000Z',
      });
      expect(harness.fixture.debugElement.query(By.directive(GroupDetailPage))).not.toBeNull();

      await harness.navigateByUrl('/unirse', Shell);
      expect(harness.fixture.debugElement.query(By.directive(JoinGroupPage))).not.toBeNull();
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

    it('redirects /registro to /grupos with a session', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/registro', Shell);
      http.expectOne('/api/groups').flush([]);

      expect(harness.fixture.debugElement.query(By.directive(GroupsListPage))).not.toBeNull();
      expect(router.url).toBe('/grupos');
    });

    it('redirects unknown routes to /grupos', async () => {
      store.setSession(session);
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/no-existe');
      http.expectOne('/api/groups').flush([]);

      expect(router.url).toBe('/grupos');
    });
  });
});
