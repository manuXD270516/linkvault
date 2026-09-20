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
  typeInto,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { LoginPage } from './login.page';

/** Un slug público bien formado, el que llega por `?import=` desde una oferta pública. */
const SLUG = 'k3m9qrtv2xyz';

describe('LoginPage', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: SessionStore;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(SessionStore);
    // Sesión ya resuelta como invitado: los guards no lanzan el refresh inicial.
    store.clear();
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => verifyNoPendingRequests(http));

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  async function submitCredentials(email: string, password: string): Promise<void> {
    typeInto(host(), 'input[formControlName="email"]', email);
    typeInto(host(), 'input[formControlName="password"]', password);
    buttonWithText(host(), 'Entrar').click();
    await settle();
  }

  function alertText(): string {
    return host().querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('Login correcto con redirección', async () => {
    await harness.navigateByUrl('/perfil');
    expect(router.url).toBe('/login?returnUrl=%2Fperfil');

    await submitCredentials(' Ana@Example.com ', 'contraseña-larga');
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ email: 'ana@example.com', password: 'contraseña-larga' });
    request.flush(sessionWith('token-1'));

    await vi.waitFor(() => expect(router.url).toBe('/perfil'));
    expect(store.status()).toBe('authenticated');
  });

  it('navigates to the group list without a return route', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    http.expectOne('/api/auth/login').flush(sessionWith('token-1'));

    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http);
  });

  it('Ruta de retorno externa', async () => {
    await harness.navigateByUrl('/login?returnUrl=%2F%2Fevil.example', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    http.expectOne('/api/auth/login').flush(sessionWith('token-1'));

    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http);
  });

  it('Credenciales inválidas', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-mala');
    const { body, options } = apiError('invalid_credentials', 401);
    http.expectOne('/api/auth/login').flush(body, options);
    await vi.waitFor(() => expect(alertText()).toBe('Email o contraseña incorrectos'));
    expect(host().querySelector<HTMLInputElement>('input[formControlName="email"]')?.value).toBe(
      'ana@example.com',
    );
    http.expectNone('/api/auth/refresh');
  });

  it('Demasiados intentos', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '600' });
    http.expectOne('/api/auth/login').flush(body, options);
    await vi.waitFor(() => expect(alertText()).toBe('Demasiados intentos. Vuelve a intentarlo en 10 minutos'));
  });

  it('rounds Retry-After up to whole minutes', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '61' });
    http.expectOne('/api/auth/login').flush(body, options);
    await vi.waitFor(() => expect(alertText()).toBe('Demasiados intentos. Vuelve a intentarlo en 2 minutos'));
  });

  it('shows the offline message when the API is unreachable', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    http
      .expectOne('/api/auth/login')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await vi.waitFor(() => expect(alertText()).toBe('No pudimos conectar con LinkVault. Revisa tu conexión'));
  });

  it('shows the generic message for any other error', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    const { body, options } = apiError('internal_error', 500);
    http.expectOne('/api/auth/login').flush(body, options);
    await vi.waitFor(() => expect(alertText()).toBe('Algo salió mal. Inténtalo de nuevo'));
  });

  it('validates in the client without calling the API', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('no-es-un-email', '');
    await harness.fixture.whenStable();

    expect(host().textContent).toContain('Introduce un email válido');
    expect(host().textContent).toContain('Introduce tu contraseña');
    http.expectNone('/api/auth/login');
  });

  it('shows and hides the password', async () => {
    await harness.navigateByUrl('/login', LoginPage);
    const password = (): HTMLInputElement | null =>
      host().querySelector<HTMLInputElement>('input[formControlName="password"]');
    expect(password()?.type).toBe('password');

    buttonWithText(host(), 'Mostrar').click();
    await harness.fixture.whenStable();
    expect(password()?.type).toBe('text');

    buttonWithText(host(), 'Ocultar').click();
    await harness.fixture.whenStable();
    expect(password()?.type).toBe('password');
  });

  it('keeps the return route in the link to the registration page', async () => {
    await harness.navigateByUrl('/login?returnUrl=%2Fperfil', LoginPage);

    const link = host().querySelector<HTMLAnchorElement>('a[href^="/registro"]');
    expect(link?.getAttribute('href')).toBe('/registro?returnUrl=%2Fperfil');
  });

  it('does not add a return route to the registration link when there was none', async () => {
    await harness.navigateByUrl('/login', LoginPage);

    const link = host().querySelector<HTMLAnchorElement>('a[href^="/registro"]');
    expect(link?.getAttribute('href')).toBe('/registro');
  });

  it('El import gana a la ruta pedida', async () => {
    await harness.navigateByUrl(`/login?returnUrl=%2Fperfil&import=${SLUG}`, LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    http.expectOne('/api/auth/login').flush(sessionWith('token-1'));

    await vi.waitFor(() => expect(router.url).toBe(`/mis-links?import=${SLUG}`));
    const list = await vi.waitFor(() => http.expectOne('/api/links/mine?limit=20'));
    list.flush({ items: [], total: 0 });
    await settle();
  });

  it('keeps the import in the link to the registration page', async () => {
    await harness.navigateByUrl(`/login?import=${SLUG}`, LoginPage);

    const link = host().querySelector<HTMLAnchorElement>('a[href^="/registro"]');
    expect(link?.getAttribute('href')).toBe(`/registro?import=${SLUG}`);
  });

  it('ignores an import that is not a slug and honours the requested route', async () => {
    await harness.navigateByUrl('/login?returnUrl=%2Fperfil&import=..%2Fotra-cosa', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    http.expectOne('/api/auth/login').flush(sessionWith('token-1'));

    await vi.waitFor(() => expect(router.url).toBe('/perfil'));
  });

  it('Almacenamiento limpio tras el login', async () => {
    localStorage.clear();
    sessionStorage.clear();
    await harness.navigateByUrl('/login', LoginPage);

    await submitCredentials('ana@example.com', 'contraseña-larga');
    http.expectOne('/api/auth/login').flush(sessionWith('token-secreto'));
    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http);

    for (const storage of [localStorage, sessionStorage]) {
      const values = Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? '';
        return `${key}=${storage.getItem(key) ?? ''}`;
      });
      expect(values.join('\n')).not.toContain('token-secreto');
      expect(storage.length).toBe(0);
    }
  });
});
