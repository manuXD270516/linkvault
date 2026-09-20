import { HttpRequest, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import { AuthApi, SKIP_BEARER } from './auth.api';
import { SessionStore } from './session.store';

const user: UserProfile = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  aiConsent: {
    externalProviders: false,
    consentedAt: null,
    textVersion: null,
    currentTextVersion: '2026-09-20',
  },
  outputLanguage: 'es',
  redactName: false,
  createdAt: '2026-09-17T10:00:00.000Z',
};

const session: SessionResponse = { accessToken: 'token-1', expiresIn: 900, user };

function expectAuthPost(request: HttpRequest<unknown>, skipBearer: boolean): void {
  expect(request.method).toBe('POST');
  expect(request.headers.get('X-Requested-With')).toBe('linkvault');
  expect(request.headers.has('Authorization')).toBe(false);
  expect(request.context.get(SKIP_BEARER)).toBe(skipBearer);
}

describe('AuthApi', () => {
  let api: AuthApi;
  let store: SessionStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(AuthApi);
    store = TestBed.inject(SessionStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('registers and stores the session', async () => {
    const body = { email: 'ana@example.com', password: 'contraseña-larga', displayName: 'Ana' };
    const result = api.register(body);

    const req = http.expectOne('/api/auth/register');
    expectAuthPost(req.request, true);
    expect(req.request.body).toEqual(body);
    req.flush(session, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(session);
    expect(store.status()).toBe('authenticated');
    expect(store.accessToken()).toBe('token-1');
  });

  it('logs in and stores the session', async () => {
    const body = { email: 'ana@example.com', password: 'contraseña-larga' };
    const result = api.login(body);

    const req = http.expectOne('/api/auth/login');
    expectAuthPost(req.request, true);
    expect(req.request.body).toEqual(body);
    req.flush(session);

    await expect(result).resolves.toEqual(session);
    expect(store.user()).toEqual(user);
  });

  it('propagates login errors without storing a session', async () => {
    const result = api.login({ email: 'ana@example.com', password: 'mala' });

    http
      .expectOne('/api/auth/login')
      .flush(
        { code: 'invalid_credentials', message: 'Invalid credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(result).rejects.toMatchObject({
      status: 401,
      error: { code: 'invalid_credentials' },
    });
    expect(store.accessToken()).toBeNull();
  });

  it('refreshes with the CSRF header and without a Bearer token', async () => {
    const result = api.refresh();

    const req = http.expectOne('/api/auth/refresh');
    expectAuthPost(req.request, true);
    req.flush(session);

    await expect(result).resolves.toEqual(session);
    expect(store.status()).toBe('authenticated');
  });

  it('logs out and clears the local session', async () => {
    store.setSession(session);
    const result = api.logout();

    const req = http.expectOne('/api/auth/logout');
    expectAuthPost(req.request, true);
    req.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
  });

  it('clears the local session even when logout fails', async () => {
    store.setSession(session);
    const result = api.logout();

    http
      .expectOne('/api/auth/logout')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    await expect(result).rejects.toMatchObject({ status: 0 });
    expect(store.status()).toBe('anonymous');
  });

  it('changes the password with the CSRF header and leaves the Bearer to the interceptor', async () => {
    store.setSession(session);
    const body = { currentPassword: 'contraseña-vieja', newPassword: 'contraseña-nueva' };
    const result = api.changePassword(body);

    const req = http.expectOne('/api/auth/password');
    expectAuthPost(req.request, false);
    expect(req.request.body).toEqual(body);
    req.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
    expect(store.accessToken()).toBe('token-1');
  });

  it('loads the profile into the store', async () => {
    store.setSession(session);
    const result = api.getProfile();

    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.has('X-Requested-With')).toBe(false);
    expect(req.request.context.get(SKIP_BEARER)).toBe(false);
    req.flush({ ...user, displayName: 'Ana María' });

    await expect(result).resolves.toMatchObject({ displayName: 'Ana María' });
    expect(store.user()?.displayName).toBe('Ana María');
  });

  it('updates the profile with only the given fields', async () => {
    store.setSession(session);
    const result = api.updateProfile({ displayName: 'Ana María' });

    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ displayName: 'Ana María' });
    expect(req.request.context.get(SKIP_BEARER)).toBe(false);
    req.flush({ ...user, displayName: 'Ana María' });

    await expect(result).resolves.toMatchObject({ displayName: 'Ana María' });
    expect(store.user()?.displayName).toBe('Ana María');
  });
});
