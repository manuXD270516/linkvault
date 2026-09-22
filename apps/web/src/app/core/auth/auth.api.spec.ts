import { HttpRequest, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import { AuthApi, SKIP_BEARER } from './auth.api';
import { SessionStore } from './session.store';

const user: UserProfile = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  emailVerified: true,
  aiConsent: {
    externalProviders: false,
    consentedAt: null,
    textVersion: null,
    currentTextVersion: AI_CONSENT_TEXT_VERSION,
  },
  outputLanguage: 'es',
  redactName: true,
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

  it('requests a password reset without storing a session', async () => {
    const result = api.forgotPassword({ email: 'ana@example.com' });

    const req = http.expectOne('/api/auth/forgot-password');
    expectAuthPost(req.request, true);
    expect(req.request.body).toEqual({ email: 'ana@example.com' });
    req.flush({ message: 'ok' });

    await expect(result).resolves.toEqual({ message: 'ok' });
    expect(store.accessToken()).toBeNull();
  });

  it('resets the password with the CSRF header and without a Bearer token', async () => {
    const result = api.resetPassword({ token: 't1', newPassword: 'contraseña-nueva' });

    const req = http.expectOne('/api/auth/reset-password');
    expectAuthPost(req.request, true);
    expect(req.request.body).toEqual({ token: 't1', newPassword: 'contraseña-nueva' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  it('verifies the email with the CSRF header and without a Bearer token', async () => {
    const result = api.verifyEmail({ token: 't1' });

    const req = http.expectOne('/api/auth/verify-email');
    expectAuthPost(req.request, true);
    expect(req.request.body).toEqual({ token: 't1' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  it('resends the verification email for the current session', async () => {
    store.setSession(session);
    const result = api.resendVerifyEmail();

    const req = http.expectOne('/api/auth/verify-email/resend');
    expectAuthPost(req.request, false);
    expect(req.request.body).toBeNull();
    req.flush({ message: 'ok' });

    await expect(result).resolves.toEqual({ message: 'ok' });
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

  it('activa el consentimiento con la versión mostrada', async () => {
    store.setSession(session);
    const result = api.updateProfile({
      aiConsent: { externalProviders: true, textVersion: AI_CONSENT_TEXT_VERSION },
    });

    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      aiConsent: { externalProviders: true, textVersion: AI_CONSENT_TEXT_VERSION },
    });
    req.flush({
      ...user,
      aiConsent: {
        externalProviders: true,
        consentedAt: '2026-09-21T12:00:00.000Z',
        textVersion: AI_CONSENT_TEXT_VERSION,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
    });

    await expect(result).resolves.toMatchObject({
      aiConsent: {
        externalProviders: true,
        textVersion: AI_CONSENT_TEXT_VERSION,
        consentedAt: '2026-09-21T12:00:00.000Z',
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
    });
  });

  it('propaga 409 consent_text_outdated', async () => {
    store.setSession(session);
    const result = api.updateProfile({
      aiConsent: { externalProviders: true, textVersion: '2026-01-01' },
    });

    http
      .expectOne('/api/users/me')
      .flush(
        { code: 'consent_text_outdated', message: 'outdated' },
        { status: 409, statusText: 'Conflict' },
      );

    await expect(result).rejects.toMatchObject({
      status: 409,
      error: { code: 'consent_text_outdated' },
    });
  });

  it('revoca el consentimiento sin versión', async () => {
    store.setSession(session);
    const result = api.updateProfile({ aiConsent: { externalProviders: false } });

    const req = http.expectOne('/api/users/me');
    expect(req.request.body).toEqual({ aiConsent: { externalProviders: false } });
    req.flush({
      ...user,
      aiConsent: {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
    });

    await expect(result).resolves.toMatchObject({
      aiConsent: { externalProviders: false, textVersion: null, consentedAt: null },
    });
  });

  it('propaga 500 al actualizar el perfil', async () => {
    store.setSession(session);
    const result = api.updateProfile({ redactName: false });

    http
      .expectOne('/api/users/me')
      .flush({ code: 'internal_error', message: 'boom' }, { status: 500, statusText: 'Error' });

    await expect(result).rejects.toMatchObject({ status: 500 });
  });

  it('borra la cuenta y limpia la sesión local tras 204', async () => {
    store.setSession(session);
    const result = api.deleteAccount({ password: 'contraseña-correcta' });

    const req = http.expectOne({ method: 'DELETE', url: '/api/users/me' });
    expect(req.request.body).toEqual({ password: 'contraseña-correcta' });
    expect(req.request.context.get(SKIP_BEARER)).toBe(false);
    req.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
  });

  it('propaga 401 invalid_credentials sin limpiar la sesión', async () => {
    store.setSession(session);
    const result = api.deleteAccount({ password: 'mala' });

    http
      .expectOne({ method: 'DELETE', url: '/api/users/me' })
      .flush(
        { code: 'invalid_credentials', message: 'Invalid email or password' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(result).rejects.toMatchObject({
      status: 401,
      error: { code: 'invalid_credentials' },
    });
    expect(store.status()).toBe('authenticated');
    expect(store.accessToken()).toBe('token-1');
  });
});