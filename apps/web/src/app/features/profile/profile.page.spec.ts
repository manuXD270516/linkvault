import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AI_CONSENT_TEXT_VERSION, type AiKeyView } from '@linkvault/shared';
import {
  apiError,
  buttonWithText,
  providePageTesting,
  sessionWith,
  settle,
  testUser,
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { AiKeysStore } from '../../core/ai-keys/ai-keys.store';
import { Shell } from '../../layout/shell/shell';
import { ProfilePage } from './profile.page';

const openaiKey: AiKeyView = {
  vendor: 'openai',
  keyHint: 'sk12',
  updatedAt: '2026-09-21T12:00:00.000Z',
};

const anthropicKey: AiKeyView = {
  vendor: 'anthropic',
  keyHint: 'an34',
  updatedAt: '2026-09-21T12:00:00.000Z',
};

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
    await flushAiKeys([]);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    verifyNoPendingRequests(http);
  });

  async function flushAiKeys(keys: AiKeyView[]): Promise<void> {
    const request = await vi.waitFor(() =>
      http.expectOne({ method: 'GET', url: '/api/users/me/ai-keys' }),
    );
    request.flush({ keys });
    await settle();
    await harness.fixture.whenStable();
  }

  /** Vuelve a pedir el listado del store de la página (p. ej. para precargar un hint). */
  async function reloadAiKeys(keys: AiKeyView[]): Promise<void> {
    const page = harness.fixture.debugElement.query(By.directive(ProfilePage));
    void page.injector.get(AiKeysStore).load();
    await flushAiKeys(keys);
  }

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function input(name: string): HTMLInputElement | null {
    return host().querySelector<HTMLInputElement>(`input[formControlName="${name}"]`);
  }

  function byokKeyInput(vendor: string): HTMLInputElement {
    const el = host().querySelector<HTMLInputElement>(`[data-testid="profile-byok-key-${vendor}"]`);
    if (!el) {
      throw new Error(`BYOK key input missing for ${vendor}`);
    }
    return el;
  }

  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  async function answerConfirm(label: string): Promise<void> {
    buttonWithText(dialog(), label).click();
    await settle();
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

  describe('IA y privacidad', () => {
    function consentToggle(): HTMLElement {
      const el = host().querySelector<HTMLElement>('[data-testid="profile-ai-consent"]');
      if (!el) {
        throw new Error('consent toggle missing');
      }
      return el;
    }

    function consentButton(): HTMLButtonElement {
      const button = consentToggle().querySelector('button');
      if (!button) {
        throw new Error('consent button missing');
      }
      return button;
    }

    it('Lo que decide se lee primero', () => {
      const consentText =
        host().querySelector('[data-testid="profile-ai-consent-text"]')?.textContent?.trim() ?? '';
      const first = consentText.split(/(?<=[.!?])\s+/)[0] ?? '';
      expect(first).toMatch(/sale de LinkVault hacia un proveedor de IA externo/);
      expect(first).toMatch(/puede identificarte/);
      expect(consentText.indexOf(first)).toBe(0);
    });

    it('El texto dice qué se envía y a quién', () => {
      expect(text()).toContain('IA y privacidad');
      expect(text()).toMatch(/texto de tu CV y la descripción de la oferta/);
      expect(text()).toMatch(/OpenRouter/);
      expect(text()).toMatch(/email/);
      expect(text()).toMatch(/Puedes quitar este permiso cuando quieras/);
      expect(text()).toMatch(/análisis básico, sin sugerencias/);
    });

    it('El texto dice qué pasa con el resto del CV', () => {
      expect(text()).toMatch(/resto de tu CV/);
      expect(text()).toMatch(/se envía tal cual y puede identificarte/);
      expect(text()).toMatch(/no podemos comprobarlo/);
    });

    it('Dar el permiso deja constancia', async () => {
      consentButton().click();
      await settle();

      const request = http.expectOne('/api/users/me');
      expect(request.request.body).toEqual({
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
        },
      });
      request.flush({
        ...testUser,
        aiConsent: {
          externalProviders: true,
          consentedAt: '2026-09-21T12:00:00.000Z',
          textVersion: AI_CONSENT_TEXT_VERSION,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
      });
      await settle();
      await harness.fixture.whenStable();

      expect(text()).toMatch(/Concedido el/);
      expect(text()).toContain(AI_CONSENT_TEXT_VERSION);
      expect(store.user()?.aiConsent.textVersion).toBe(AI_CONSENT_TEXT_VERSION);
    });

    it('nunca envía una versión que no llegó a pintar', async () => {
      consentButton().click();
      await settle();
      const request = http.expectOne('/api/users/me');
      expect(request.request.body.aiConsent.textVersion).toBe(AI_CONSENT_TEXT_VERSION);
      expect(request.request.body.aiConsent.textVersion).not.toBe('2026-09-20');
      request.flush({
        ...testUser,
        aiConsent: {
          externalProviders: true,
          consentedAt: '2026-09-21T12:00:00.000Z',
          textVersion: AI_CONSENT_TEXT_VERSION,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
      });
    });

    it('Quitar el permiso en un clic', async () => {
      store.setUser({
        ...testUser,
        aiConsent: {
          externalProviders: true,
          consentedAt: '2026-09-21T12:00:00.000Z',
          textVersion: AI_CONSENT_TEXT_VERSION,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
      });
      harness.fixture.detectChanges();
      await harness.fixture.whenStable();
      expect(consentButton().getAttribute('aria-checked')).toBe('true');

      consentButton().click();
      await settle();
      const request = http.expectOne('/api/users/me');
      expect(request.request.body).toEqual({ aiConsent: { externalProviders: false } });
      request.flush({
        ...testUser,
        aiConsent: {
          externalProviders: false,
          consentedAt: null,
          textVersion: null,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
      });
      await settle();
      harness.fixture.detectChanges();
      await harness.fixture.whenStable();

      const notice =
        host().querySelector('[data-testid="profile-ai-consent-revoked"]')?.textContent ?? '';
      expect(notice).toContain('Permiso retirado');
      expect(notice).toContain('No borra los análisis que ya hiciste');
      expect(notice.trim().endsWith('no se puede recuperar.')).toBe(true);
      expect(notice).not.toMatch(/borra lo ya enviado/i);
    });

    it('La API falla al guardar un control de IA', async () => {
      consentButton().click();
      await settle();
      const { body, options } = apiError('internal_error', 500);
      http.expectOne('/api/users/me').flush(body, options);
      await settle();
      await harness.fixture.whenStable();

      expect(consentButton().getAttribute('aria-checked')).toBe('false');
      expect(store.user()?.aiConsent.externalProviders).toBe(false);
    });

    it('El texto cambió después de aceptarlo', async () => {
      store.setUser({
        ...testUser,
        aiConsent: {
          externalProviders: true,
          consentedAt: '2026-01-01T00:00:00.000Z',
          textVersion: '2026-01-01',
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
      });
      await harness.fixture.whenStable();

      expect(host().querySelector('[data-testid="profile-ai-consent-outdated"]')).not.toBeNull();
      expect(text()).toMatch(/ya no está en vigor/);
      expect(consentButton().getAttribute('aria-checked')).toBe('false');
      expect(text()).toContain('2026-01-01');
      http.expectNone('/api/users/me');
    });

    it('El idioma de los análisis no es el de la pantalla', async () => {
      expect(text()).toContain('No cambia el idioma de la interfaz');
      const page = harness.fixture.debugElement.query(By.directive(ProfilePage))
        .componentInstance as ProfilePage & {
        onOutputLanguage: (language: 'es' | 'en') => Promise<void>;
      };
      const pending = page.onOutputLanguage('en');
      await settle();

      const request = http.expectOne('/api/users/me');
      expect(request.request.body).toEqual({ outputLanguage: 'en' });
      request.flush({ ...testUser, outputLanguage: 'en' });
      await pending;
      expect(router.url).toBe('/perfil');
    });

    it('El nombre viene oculto de fábrica', () => {
      const redact = host().querySelector('[data-testid="profile-ai-redact-name"] button');
      expect(redact?.getAttribute('aria-checked')).toBe('true');
    });

    it('Ocultar el nombre sin haber dado el permiso', async () => {
      expect(store.user()?.aiConsent.externalProviders).toBe(false);
      const redact = host().querySelector<HTMLButtonElement>(
        '[data-testid="profile-ai-redact-name"] button',
      );
      expect(redact).not.toBeNull();
      expect(text()).toContain('Solo tiene efecto cuando se usa un proveedor externo');
      redact?.click();
      await settle();
      const request = http.expectOne('/api/users/me');
      expect(request.request.body).toEqual({ redactName: false });
      request.flush({ ...testUser, redactName: false });
    });
  });

  describe('Claves BYOK', () => {
    it('muestra el aviso de destino con el nombre del vendor', () => {
      expect(host().querySelector('[data-testid="profile-byok"]')).not.toBeNull();
      const openai = host().querySelector('[data-testid="profile-byok-destination-openai"]');
      expect(openai?.textContent).toMatch(/OpenAI/);
      expect(openai?.textContent).toMatch(/puede salir hacia/);
      const anthropic = host().querySelector('[data-testid="profile-byok-destination-anthropic"]');
      expect(anthropic?.textContent).toMatch(/Anthropic/);
    });

    it('OpenRouter avisa que no se fuerza data_collection: deny si el modelo no es :free', () => {
      const notice = host().querySelector(
        '[data-testid="profile-byok-openrouter-data-collection"]',
      );
      expect(notice?.textContent).toMatch(/data_collection:\s*deny/);
      expect(notice?.textContent).toMatch(/:free/);
      expect(
        host().querySelector('[data-testid="profile-byok-destination-openrouter"]')?.textContent,
      ).toMatch(/OpenRouter/);
    });

    it('Guarda OpenAI y muestra el hint sin dejar la clave en el campo', async () => {
      const pasted = 'sk-live-openai-key-16';
      typeInto(host(), '[data-testid="profile-byok-key-openai"]', pasted);
      host().querySelector<HTMLButtonElement>('[data-testid="profile-byok-save-openai"]')?.click();
      await settle();

      const put = http.expectOne({ method: 'PUT', url: '/api/users/me/ai-keys/openai' });
      expect(put.request.body).toEqual({ apiKey: pasted });
      expect(put.request.headers.get('Authorization')).toBe('Bearer token-1');
      put.flush(openaiKey);
      await settle();
      const list = http.expectOne({ method: 'GET', url: '/api/users/me/ai-keys' });
      list.flush({ keys: [openaiKey] });
      await settle();
      await harness.fixture.whenStable();

      expect(host().querySelector('[data-testid="profile-byok-status-openai"]')?.textContent).toMatch(
        /Configurada/,
      );
      expect(host().querySelector('[data-testid="profile-byok-hint-openai"]')?.textContent).toContain(
        'sk12',
      );
      expect(byokKeyInput('openai').value).toBe('');
      expect(byokKeyInput('openai').type).toBe('password');
    });

    it('Revoca Anthropic tras confirmar', async () => {
      await reloadAiKeys([anthropicKey]);

      expect(
        host().querySelector('[data-testid="profile-byok-status-anthropic"]')?.textContent,
      ).toMatch(/Configurada/);
      host()
        .querySelector<HTMLButtonElement>('[data-testid="profile-byok-revoke-anthropic"]')
        ?.click();
      await settle();
      await harness.fixture.whenStable();

      expect(dialog().textContent).toMatch(/Anthropic/);
      await answerConfirm('Revocar');

      const del = await vi.waitFor(() =>
        http.expectOne({ method: 'DELETE', url: '/api/users/me/ai-keys/anthropic' }),
      );
      del.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      http.expectOne({ method: 'GET', url: '/api/users/me/ai-keys' }).flush({ keys: [] });
      await settle();
      await harness.fixture.whenStable();

      expect(
        host().querySelector('[data-testid="profile-byok-status-anthropic"]')?.textContent,
      ).toMatch(/Sin configurar/);
      expect(host().querySelector('[data-testid="profile-byok-revoke-anthropic"]')).toBeNull();
    });

    it('Con hint y consentimiento off dice que las claves no se usan', async () => {
      await reloadAiKeys([openaiKey]);

      expect(store.user()?.aiConsent.externalProviders).toBe(false);
      const notice = host().querySelector('[data-testid="profile-byok-consent-off"]');
      expect(notice?.textContent).toMatch(/no se usan/);
      expect(notice?.textContent).toMatch(/no las borró/);
      expect(host().querySelector('[data-testid="profile-byok-hint-openai"]')?.textContent).toContain(
        'sk12',
      );
    });
  });
});
