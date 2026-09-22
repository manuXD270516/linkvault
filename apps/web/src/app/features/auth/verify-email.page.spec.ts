import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  apiError,
  buttonWithText,
  flushGroupsList,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { Shell } from '../../layout/shell/shell';
import { VerifyEmailPage } from './verify-email.page';

describe('VerifyEmailPage', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: SessionStore;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(SessionStore);
    store.clear();
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    verifyNoPendingRequests(http);
  });

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function alertText(): string {
    return host().querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function statusText(): string {
    return host().querySelector('[role="status"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Verificación con sesión', async () => {
    localStorage.clear();
    sessionStorage.clear();
    store.setSession(sessionWith('token-1', { ...testUser, emailVerified: false }));
    await harness.navigateByUrl('/verificar-email?token=token-valido', VerifyEmailPage);

    const verify = await vi.waitFor(() => http.expectOne('/api/auth/verify-email'));
    expect(verify.request.body).toEqual({ token: 'token-valido' });
    expect(verify.request.headers.get('X-Requested-With')).toBe('linkvault');
    verify.flush(null, { status: 204, statusText: 'No Content' });

    const profile = await vi.waitFor(() => http.expectOne('/api/users/me'));
    profile.flush({ ...testUser, emailVerified: true });

    await vi.waitFor(() => expect(statusText()).toBe('Email verificado'));
    expect(store.user()?.emailVerified).toBe(true);
    expect(router.url).toBe('/verificar-email?token=token-valido');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('Enlace inválido', async () => {
    localStorage.clear();
    sessionStorage.clear();
    await harness.navigateByUrl('/verificar-email?token=basura', VerifyEmailPage);

    const { body, options } = apiError('invalid_token', 400);
    const request = await vi.waitFor(() => http.expectOne('/api/auth/verify-email'));
    request.flush(body, options);
    await vi.waitFor(() => expect(alertText()).toContain('no es válido o ha caducado'));
    expect(host().textContent).not.toMatch(/reenviar/i);
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('offers login when verification succeeds without a session', async () => {
    await harness.navigateByUrl('/verificar-email?token=token-valido', VerifyEmailPage);

    const request = await vi.waitFor(() => http.expectOne('/api/auth/verify-email'));
    request.flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() => expect(statusText()).toBe('Email verificado'));
    expect(host().querySelector('a[href="/login"]')).not.toBeNull();
    http.expectNone('/api/users/me');
  });

  it('Verificar email con sesión no redirige a grupos', async () => {
    store.setSession(sessionWith('token-1', { ...testUser, emailVerified: false }));
    await harness.navigateByUrl('/verificar-email?token=token-valido', VerifyEmailPage);

    const verify = await vi.waitFor(() => http.expectOne('/api/auth/verify-email'));
    verify.flush(null, { status: 204, statusText: 'No Content' });
    const profile = await vi.waitFor(() => http.expectOne('/api/users/me'));
    profile.flush({ ...testUser, emailVerified: true });

    await vi.waitFor(() => expect(statusText()).toBe('Email verificado'));
    expect(router.url).toBe('/verificar-email?token=token-valido');
    http.expectNone('/api/groups');
  });

  it('Banner tras el registro', async () => {
    store.setSession(sessionWith('token-1', { ...testUser, emailVerified: false }));
    await harness.navigateByUrl('/grupos', Shell);
    await flushGroupsList(http);

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('[data-testid="email-unverified-banner"]')?.textContent).toContain(
      'Tu email aún no está verificado',
    );
    expect(page.textContent).toContain('Tus grupos');
  });

  it('Reenviar desde el aviso', async () => {
    store.setSession(sessionWith('token-1', { ...testUser, emailVerified: false }));
    await harness.navigateByUrl('/grupos', Shell);
    await flushGroupsList(http);

    const page = harness.routeNativeElement as HTMLElement;
    buttonWithText(page, 'Reenviar correo').click();
    await settle();

    const request = http.expectOne('/api/auth/verify-email/resend');
    expect(request.request.body).toBeNull();
    expect(request.request.headers.get('X-Requested-With')).toBe('linkvault');
    request.flush({ message: 'If needed, we sent a verification email.' });

    await vi.waitFor(() =>
      expect(page.querySelector('[data-testid="email-unverified-banner"]')?.textContent).toContain(
        'Si procede, te hemos enviado un correo de verificación',
      ),
    );
  });

  it('Aviso desaparece al verificar', async () => {
    store.setSession(sessionWith('token-1', { ...testUser, emailVerified: false }));
    await harness.navigateByUrl('/grupos', Shell);
    await flushGroupsList(http);

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('[data-testid="email-unverified-banner"]')).not.toBeNull();

    store.setUser({ ...testUser, emailVerified: true });
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();

    expect(page.querySelector('[data-testid="email-unverified-banner"]')).toBeNull();
  });
});
