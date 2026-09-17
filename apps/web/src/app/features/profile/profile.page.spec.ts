import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  typeInto,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { Shell } from '../../layout/shell/shell';
import { ProfilePage } from './profile.page';

describe('ProfilePage', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: SessionStore;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(SessionStore);
    store.setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/perfil', Shell);
    expect(harness.fixture.debugElement.query(By.directive(ProfilePage))).not.toBeNull();
  });

  afterEach(() => http.verify());

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function input(name: string): HTMLInputElement | null {
    return host().querySelector<HTMLInputElement>(`input[formControlName="${name}"]`);
  }

  async function submitPasswordChange(currentPassword: string, newPassword: string): Promise<void> {
    typeInto(host(), 'input[formControlName="currentPassword"]', currentPassword);
    typeInto(host(), 'input[formControlName="newPassword"]', newPassword);
    buttonWithText(host(), 'Cambiar contraseña').click();
    await settle();
  }

  it('shows the email read-only and the current display name', () => {
    const email = host().querySelector<HTMLInputElement>('[data-testid="profile-email"]');
    expect(email?.value).toBe('ana@example.com');
    expect(email?.readOnly).toBe(true);
    expect(input('displayName')?.value).toBe('Ana');
  });

  it('Guardar el nombre', async () => {
    typeInto(host(), 'input[formControlName="displayName"]', ' Ana María ');
    buttonWithText(host(), 'Guardar nombre').click();
    await settle();

    const request = http.expectOne('/api/users/me');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ displayName: 'Ana María' });
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush({ ...testUser, displayName: 'Ana María' });

    await vi.waitFor(() => expect(text()).toContain('Nombre guardado'));
    expect(input('displayName')?.value).toBe('Ana María');
    expect(store.user()?.displayName).toBe('Ana María');
  });

  it('Cambiar la contraseña', async () => {
    await submitPasswordChange('contraseña-vieja', 'contraseña-nueva');
    const change = http.expectOne('/api/auth/password');
    expect(change.request.body).toEqual({
      currentPassword: 'contraseña-vieja',
      newPassword: 'contraseña-nueva',
    });
    change.flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() =>
      expect(text()).toContain('Contraseña cambiada. Cerramos tu sesión en los demás dispositivos.'),
    );
    expect(router.url).toBe('/perfil');
    expect(store.status()).toBe('authenticated');
    expect(input('currentPassword')?.value).toBe('');
    expect(input('newPassword')?.value).toBe('');

    // La petición siguiente usa el token anterior, recibe 401 y se completa tras un único refresh.
    typeInto(host(), 'input[formControlName="displayName"]', 'Ana María');
    buttonWithText(host(), 'Guardar nombre').click();
    await settle();
    const { body, options } = apiError('unauthorized', 401);
    const stale = http.expectOne('/api/users/me');
    expect(stale.request.headers.get('Authorization')).toBe('Bearer token-1');
    stale.flush(body, options);
    await settle();
    http.expectOne('/api/auth/refresh').flush(sessionWith('token-2'));
    await settle();
    const retried = http.expectOne('/api/users/me');
    expect(retried.request.headers.get('Authorization')).toBe('Bearer token-2');
    retried.flush({ ...testUser, displayName: 'Ana María' });

    await vi.waitFor(() => expect(text()).toContain('Nombre guardado'));
    http.expectNone('/api/auth/refresh');
    expect(router.url).toBe('/perfil');
  });

  it('Contraseña actual incorrecta en el perfil', async () => {
    await submitPasswordChange('contraseña-mala', 'contraseña-nueva');
    const { body, options } = apiError('invalid_credentials', 401);
    http.expectOne('/api/auth/password').flush(body, options);

    await vi.waitFor(() => expect(text()).toContain('La contraseña actual no es correcta'));
    http.expectNone('/api/auth/refresh');
    expect(router.url).toBe('/perfil');
  });

  it('shows the too many attempts message', async () => {
    await submitPasswordChange('contraseña-mala', 'contraseña-nueva');
    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '600' });
    http.expectOne('/api/auth/password').flush(body, options);

    await vi.waitFor(() =>
      expect(text()).toContain('Demasiados intentos. Vuelve a intentarlo en 10 minutos'),
    );
  });

  it('shows the new password rules when the API answers 400', async () => {
    await submitPasswordChange('contraseña-vieja', 'contraseña-nueva');
    const { body, options } = apiError('validation_error', 400);
    http.expectOne('/api/auth/password').flush(body, options);

    await vi.waitFor(() =>
      expect(text()).toContain(
        'La nueva contraseña debe tener al menos 10 caracteres y no puede ser tu email',
      ),
    );
  });

  it('shows the length hint and validates the new password in the client', async () => {
    expect(text()).toContain('Mínimo 10 caracteres');

    await submitPasswordChange('contraseña-vieja', 'corta');
    await harness.fixture.whenStable();
    expect(text()).toContain(
      'La nueva contraseña debe tener al menos 10 caracteres y no puede ser tu email',
    );

    await submitPasswordChange('contraseña-vieja', 'ana@example.com');
    await harness.fixture.whenStable();
    http.expectNone('/api/auth/password');
  });

  it('shows and hides both passwords', async () => {
    const toggle = (name: string): HTMLButtonElement | null =>
      host().querySelector<HTMLButtonElement>(`[data-testid="toggle-${name}"]`);

    toggle('current-password')?.click();
    await harness.fixture.whenStable();
    expect(input('currentPassword')?.type).toBe('text');
    expect(input('newPassword')?.type).toBe('password');

    toggle('new-password')?.click();
    await harness.fixture.whenStable();
    expect(input('newPassword')?.type).toBe('text');
  });

  it('does not show AI consent, output language or name redaction controls', () => {
    expect(
      host().querySelectorAll(
        'input[type="checkbox"], input[type="radio"], select, mat-select, mat-checkbox, mat-slide-toggle, mat-radio-group',
      ),
    ).toHaveLength(0);
    for (const field of ['aiConsent', 'outputLanguage', 'redactName']) {
      expect(host().querySelector(`[formControlName="${field}"]`)).toBeNull();
    }
    expect(text()).not.toMatch(/consentimiento|idioma|redact|proveedores/i);
  });
});
