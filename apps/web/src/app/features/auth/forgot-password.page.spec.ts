import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { ForgotPasswordPage } from './forgot-password.page';

describe('ForgotPasswordPage', () => {
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

  afterEach(() => verifyNoPendingRequests(http));

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function alertText(): string {
    return host().querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function statusText(): string {
    return host().querySelector('[role="status"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Recuperar contraseña sin sesión', async () => {
    await harness.navigateByUrl('/recuperar-contrasena', ForgotPasswordPage);

    expect(router.url).toBe('/recuperar-contrasena');
    expect(host().textContent).toContain('Recuperar contraseña');
  });

  it('Envío genérico', async () => {
    await harness.navigateByUrl('/recuperar-contrasena', ForgotPasswordPage);

    typeInto(host(), 'input[formControlName="email"]', ' Ana@Example.com ');
    buttonWithText(host(), 'Enviar instrucciones').click();
    await settle();

    const request = http.expectOne('/api/auth/forgot-password');
    expect(request.request.headers.get('X-Requested-With')).toBe('linkvault');
    expect(request.request.body).toEqual({ email: 'ana@example.com' });
    request.flush({ message: 'If an account exists, we sent instructions.' });

    await vi.waitFor(() =>
      expect(statusText()).toContain(
        'Si existe una cuenta con ese email, te hemos enviado instrucciones',
      ),
    );
  });

  it('Demasiados intentos', async () => {
    await harness.navigateByUrl('/recuperar-contrasena', ForgotPasswordPage);

    typeInto(host(), 'input[formControlName="email"]', 'ana@example.com');
    buttonWithText(host(), 'Enviar instrucciones').click();
    await settle();

    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '600' });
    http.expectOne('/api/auth/forgot-password').flush(body, options);
    await vi.waitFor(() =>
      expect(alertText()).toBe('Demasiados intentos. Vuelve a intentarlo en 10 minutos'),
    );
  });

  it('stays on the page with an authenticated session', async () => {
    store.setSession(sessionWith('token-1'));
    await harness.navigateByUrl('/recuperar-contrasena', ForgotPasswordPage);

    expect(router.url).toBe('/recuperar-contrasena');
    expect(host().textContent).toContain('Recuperar contraseña');
    http.expectNone('/api/groups');
  });
});

describe('login forgot-password link', () => {
  let http: HttpTestingController;
  let store: SessionStore;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SessionStore);
    store.clear();
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('Desde login se llega a recuperar', async () => {
    await harness.navigateByUrl('/login');
    const host = harness.routeNativeElement as HTMLElement;
    const link = host.querySelector<HTMLAnchorElement>('a[href="/recuperar-contrasena"]');
    expect(link?.textContent).toContain('Olvidé mi contraseña');

    await harness.navigateByUrl('/recuperar-contrasena', ForgotPasswordPage);
    expect(harness.routeNativeElement?.textContent).toContain('Recuperar contraseña');
  });
});
