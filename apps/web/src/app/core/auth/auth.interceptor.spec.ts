import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from './auth.api';
import { authInterceptor } from './auth.interceptor';
import { REFRESH_LOCKS } from './refresh-coordination';
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

function sessionWith(accessToken: string): SessionResponse {
  return { accessToken, expiresIn: 900, user };
}

const unauthorized = { status: 401, statusText: 'Unauthorized' };

@Component({ template: '' })
class BlankPage {}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let store: SessionStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: BlankPage },
          { path: 'perfil', component: BlankPage },
          { path: 'login', component: BlankPage },
        ]),
        { provide: REFRESH_LOCKS, useValue: null },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    store = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
    store.setSession(sessionWith('token-1'));
  });

  afterEach(() => http.verify());

  it('attaches the Bearer token to API requests', async () => {
    const result = firstValueFrom(client.get('/api/users/me'));

    const request = http.expectOne('/api/users/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush(user);

    await expect(result).resolves.toEqual(user);
  });

  it('does not attach the Bearer token outside /api', async () => {
    const result = firstValueFrom(client.get('/assets/data.json'));

    const request = http.expectOne('/assets/data.json');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});

    await result;
  });

  it('does not attach the Bearer token to login, register, refresh or logout', async () => {
    const authApi = TestBed.inject(AuthApi);
    const calls = [
      authApi.login({ email: 'ana@example.com', password: 'contraseña-larga' }),
      authApi.register({
        email: 'ana@example.com',
        password: 'contraseña-larga',
        displayName: 'Ana',
      }),
      authApi.refresh(),
    ];
    await settle();

    for (const url of ['/api/auth/login', '/api/auth/register', '/api/auth/refresh']) {
      const request = http.expectOne(url);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush(sessionWith('token-2'));
    }
    await Promise.all(calls);

    const logout = authApi.logout();
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(null, { status: 204, statusText: 'No Content' });
    await logout;
  });

  it('Token caducado durante el uso', async () => {
    const first = firstValueFrom(client.get('/api/users/me'));
    const second = firstValueFrom(client.get('/api/groups'));

    for (const url of ['/api/users/me', '/api/groups']) {
      http
        .expectOne(url)
        .flush({ code: 'unauthorized', message: 'Unauthorized' }, unauthorized);
    }
    await settle();
    const refresh = http.expectOne('/api/auth/refresh');
    refresh.flush(sessionWith('token-2'));
    await settle();

    const retriedMe = http.expectOne('/api/users/me');
    const retriedGroups = http.expectOne('/api/groups');
    expect(retriedMe.request.headers.get('Authorization')).toBe('Bearer token-2');
    expect(retriedGroups.request.headers.get('Authorization')).toBe('Bearer token-2');
    retriedMe.flush(user);
    retriedGroups.flush([]);

    await expect(first).resolves.toEqual(user);
    await expect(second).resolves.toEqual([]);
    http.expectNone('/api/auth/refresh');
  });

  it('Refresh rechazado', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/perfil');
    const result = firstValueFrom(client.get('/api/users/me'));

    http
      .expectOne('/api/users/me')
      .flush({ code: 'unauthorized', message: 'Unauthorized' }, unauthorized);
    await settle();
    http
      .expectOne('/api/auth/refresh')
      .flush({ code: 'invalid_refresh', message: 'Invalid refresh' }, unauthorized);

    await expect(result).rejects.toMatchObject({ status: 401 });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/login?returnUrl=%2Fperfil');
    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
  });

  it('does not renew again when the retried request is rejected', async () => {
    const result = firstValueFrom(client.get('/api/users/me'));

    http
      .expectOne('/api/users/me')
      .flush({ code: 'unauthorized', message: 'Unauthorized' }, unauthorized);
    await settle();
    http.expectOne('/api/auth/refresh').flush(sessionWith('token-2'));
    await settle();
    http
      .expectOne('/api/users/me')
      .flush({ code: 'unauthorized', message: 'Unauthorized' }, unauthorized);

    await expect(result).rejects.toMatchObject({ status: 401 });
    await settle();
    http.expectNone('/api/auth/refresh');
    expect(store.accessToken()).toBe('token-2');
  });

  it('Contraseña actual incorrecta no renueva', async () => {
    const result = TestBed.inject(AuthApi).changePassword({
      currentPassword: 'contraseña-mala',
      newPassword: 'contraseña-nueva',
    });

    const request = http.expectOne('/api/auth/password');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush(
      { code: 'invalid_credentials', message: 'Invalid credentials' },
      unauthorized,
    );

    await expect(result).rejects.toMatchObject({
      status: 401,
      error: { code: 'invalid_credentials' },
    });
    await settle();
    http.expectNone('/api/auth/refresh');
    expect(store.status()).toBe('authenticated');
  });
});
