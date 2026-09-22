import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { ResetPasswordPage } from './reset-password.page';

describe('ResetPasswordPage', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: SessionStore;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
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

  it('Reset correcto', async () => {
    localStorage.clear();
    sessionStorage.clear();
    await harness.navigateByUrl('/restablecer-contrasena?token=token-valido', ResetPasswordPage);

    typeInto(host(), 'input[formControlName="newPassword"]', 'contraseña-nueva');
    buttonWithText(host(), 'Guardar contraseña').click();
    await settle();

    const request = http.expectOne('/api/auth/reset-password');
    expect(request.request.body).toEqual({
      token: 'token-valido',
      newPassword: 'contraseña-nueva',
    });
    request.flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(statusText()).toContain('Tu contraseña se ha actualizado'));
    expect(host().querySelector('a[href="/login"]')).not.toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('Token inválido en reset', async () => {
    await harness.navigateByUrl('/restablecer-contrasena?token=basura', ResetPasswordPage);

    typeInto(host(), 'input[formControlName="newPassword"]', 'contraseña-nueva');
    buttonWithText(host(), 'Guardar contraseña').click();
    await settle();

    const { body, options } = apiError('invalid_token', 400);
    http.expectOne('/api/auth/reset-password').flush(body, options);
    await vi.waitFor(() => expect(alertText()).toContain('no es válido o ha caducado'));
  });

  it('keeps the password field on validation errors', async () => {
    await harness.navigateByUrl('/restablecer-contrasena?token=token-valido', ResetPasswordPage);

    typeInto(host(), 'input[formControlName="newPassword"]', 'contraseña-nueva');
    buttonWithText(host(), 'Guardar contraseña').click();
    await settle();

    const { body, options } = apiError('validation_error', 400);
    http.expectOne('/api/auth/reset-password').flush(body, options);
    await vi.waitFor(() => expect(alertText()).toContain('Algo salió mal'));
    expect(host().querySelector<HTMLInputElement>('input[formControlName="newPassword"]')?.value).toBe(
      'contraseña-nueva',
    );
  });

  it('shows the invalid message when the token is missing', async () => {
    await harness.navigateByUrl('/restablecer-contrasena', ResetPasswordPage);

    expect(alertText()).toContain('no es válido o ha caducado');
    http.expectNone('/api/auth/reset-password');
    expect(router.url).toBe('/restablecer-contrasena');
  });
});
