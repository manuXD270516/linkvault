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
import { RegisterPage } from './register.page';

/** Un slug público bien formado, el que llega por `?import=` desde una oferta pública. */
const SLUG = 'k3m9qrtv2xyz';

describe('RegisterPage', () => {
  let http: HttpTestingController;
  let router: Router;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    // Sesión ya resuelta como invitado: los guards no lanzan el refresh inicial.
    TestBed.inject(SessionStore).clear();
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => verifyNoPendingRequests(http));

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function emailInput(): HTMLInputElement | null {
    return host().querySelector<HTMLInputElement>('input[formControlName="email"]');
  }

  /**
   * Responde a lo que `/mis-links?import=<slug>` pide al entrar: la primera página de la lista privada y el preview
   * público de la oferta, que aquí se responde con un `404` porque lo que se prueba es adónde se navega, no la
   * importación, que tiene sus propios tests.
   */
  async function flushMyLinks(): Promise<void> {
    const list = await vi.waitFor(() => http.expectOne('/api/links/mine?limit=20'));
    list.flush({ items: [], total: 0 });
    const preview = await vi.waitFor(() => http.expectOne(`/api/public/previews/${SLUG}`));
    const { body, options } = apiError('link_not_found', 404);
    preview.flush(body, options);
    await settle();
  }

  async function register(displayName: string, email: string, password: string): Promise<void> {
    typeInto(host(), 'input[formControlName="displayName"]', displayName);
    typeInto(host(), 'input[formControlName="email"]', email);
    typeInto(host(), 'input[formControlName="password"]', password);
    buttonWithText(host(), 'Crear cuenta').click();
    await settle();
  }

  it('shows the length hint and the data notice', async () => {
    await harness.navigateByUrl('/registro', RegisterPage);

    expect(text()).toContain('Mínimo 10 caracteres');
    expect(text()).toContain(
      'Usamos tu email para iniciar sesión y tu nombre para mostrarte en tus grupos. No lo compartimos fuera de LinkVault.',
    );
  });

  it('Registro conserva la ruta pedida', async () => {
    await harness.navigateByUrl('/perfil', LoginPage);
    expect(router.url).toBe('/login?returnUrl=%2Fperfil');
    const toRegister = host().querySelector<HTMLAnchorElement>('a[href^="/registro"]');
    toRegister?.click();
    await vi.waitFor(() => expect(router.url).toBe('/registro?returnUrl=%2Fperfil'));
    await harness.fixture.whenStable();

    await register(' Ana ', 'ana@example.com', 'contraseña-larga');
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body).toEqual({
      displayName: 'Ana',
      email: 'ana@example.com',
      password: 'contraseña-larga',
    });
    request.flush(sessionWith('token-1'), { status: 201, statusText: 'Created' });

    await vi.waitFor(() => expect(router.url).toBe('/perfil'));
  });

  it('keeps the return route in the link to the login page', async () => {
    await harness.navigateByUrl('/registro?returnUrl=%2Fperfil', RegisterPage);

    const links = Array.from(host().querySelectorAll<HTMLAnchorElement>('a[href^="/login"]'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/login?returnUrl=%2Fperfil']);
  });

  it('does not add a return route to the login link when there was none', async () => {
    await harness.navigateByUrl('/registro', RegisterPage);

    const links = Array.from(host().querySelectorAll<HTMLAnchorElement>('a[href^="/login"]'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/login']);
  });

  it('navigates to the group list without a return route', async () => {
    await harness.navigateByUrl('/registro', RegisterPage);

    await register('Ana', 'ana@example.com', 'contraseña-larga');
    http
      .expectOne('/api/auth/register')
      .flush(sessionWith('token-1'), { status: 201, statusText: 'Created' });

    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http);
  });

  it('El import viaja entre registro y login', async () => {
    await harness.navigateByUrl(`/registro?import=${SLUG}`, RegisterPage);

    const links = Array.from(host().querySelectorAll<HTMLAnchorElement>('a[href^="/login"]'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([`/login?import=${SLUG}`]);
  });

  it('Del registro al login sin perder la oferta', async () => {
    await harness.navigateByUrl(`/registro?import=${SLUG}`, RegisterPage);

    // El escenario habla de **pulsar** "¿Ya tienes cuenta?", no de mirar su `href`: se sigue el enlace de verdad.
    host().querySelector<HTMLAnchorElement>('a[href^="/login"]')?.click();

    await vi.waitFor(() => expect(router.url).toBe(`/login?import=${SLUG}`));
  });

  it('Registro con sesión abierta', async () => {
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));

    await harness.navigateByUrl(`/registro?import=${SLUG}`);

    // No llega a verse el registro: `guestGuard` lo desvía a la lista privada, y no al inicio.
    await vi.waitFor(() => expect(router.url).toBe(`/mis-links?import=${SLUG}`));
    await flushMyLinks();
  });

  it('keeps both the return route and the import in the link to the login page', async () => {
    await harness.navigateByUrl(`/registro?returnUrl=%2Fperfil&import=${SLUG}`, RegisterPage);

    const link = host().querySelector<HTMLAnchorElement>('a[href^="/login"]');
    expect(link?.getAttribute('href')).toBe(`/login?returnUrl=%2Fperfil&import=${SLUG}`);
  });

  it('Con cuenta recién creada', async () => {
    await harness.navigateByUrl(`/registro?import=${SLUG}`, RegisterPage);

    await register('Ana', 'ana@example.com', 'contraseña-larga');
    http
      .expectOne('/api/auth/register')
      .flush(sessionWith('token-1'), { status: 201, statusText: 'Created' });

    await vi.waitFor(() => expect(router.url).toBe(`/mis-links?import=${SLUG}`));
    await flushMyLinks();
  });

  it('Import inventado', async () => {
    await harness.navigateByUrl('/registro?import=..%2Fotra-cosa', RegisterPage);

    await register('Ana', 'ana@example.com', 'contraseña-larga');
    http
      .expectOne('/api/auth/register')
      .flush(sessionWith('token-1'), { status: 201, statusText: 'Created' });

    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http);
    // Nada se guarda: el `import` se ignoró antes de navegar.
    http.expectNone('/api/links');
  });

  it('Email ya registrado', async () => {
    await harness.navigateByUrl('/registro?returnUrl=%2Fperfil', RegisterPage);

    await register('Ana', 'Ana@Example.com', 'contraseña-larga');
    const { body, options } = apiError('email_taken', 409);
    http.expectOne('/api/auth/register').flush(body, options);
    await vi.waitFor(() =>
      expect(host().querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Ya existe una cuenta con este email. ¿Quieres iniciar sesión?',
      ),
    );
    expect(emailInput()?.value).toBe('Ana@Example.com');

    const toLogin = host().querySelector<HTMLAnchorElement>('[role="alert"] a');
    expect(toLogin?.getAttribute('href')).toBe('/login?returnUrl=%2Fperfil');
    toLogin?.click();
    await vi.waitFor(() => expect(router.url).toBe('/login?returnUrl=%2Fperfil'));
    await harness.fixture.whenStable();

    expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(LoginPage);
    expect(emailInput()?.value).toBe('ana@example.com');
    expect(router.url).not.toContain('ana');
    expect(decodeURIComponent(router.url)).not.toContain('example.com');
  });

  it('validates in the client without calling the API', async () => {
    await harness.navigateByUrl('/registro', RegisterPage);

    await register('   ', 'no-es-un-email', 'corta');
    await harness.fixture.whenStable();

    expect(text()).toContain('Escribe un nombre de hasta 60 caracteres');
    expect(text()).toContain('Introduce un email válido');
    expect(text()).toContain('La contraseña debe tener entre 10 y 128 caracteres');
    http.expectNone('/api/auth/register');
  });

  it('rejects a password equal to the email in the client', async () => {
    await harness.navigateByUrl('/registro', RegisterPage);

    await register('Ana', 'ana.larga@example.com', 'ana.larga@example.com');
    await harness.fixture.whenStable();

    expect(text()).toContain('La contraseña no puede ser tu email');
    http.expectNone('/api/auth/register');
  });

  it('shows the too many attempts message', async () => {
    await harness.navigateByUrl('/registro', RegisterPage);

    await register('Ana', 'ana@example.com', 'contraseña-larga');
    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '900' });
    http.expectOne('/api/auth/register').flush(body, options);

    await vi.waitFor(() =>
      expect(text()).toContain('Demasiados intentos. Vuelve a intentarlo en 15 minutos'),
    );
  });

  it('shows and hides the password', async () => {
    await harness.navigateByUrl('/registro', RegisterPage);
    const password = (): HTMLInputElement | null =>
      host().querySelector<HTMLInputElement>('input[formControlName="password"]');

    buttonWithText(host(), 'Mostrar').click();
    await harness.fixture.whenStable();
    expect(password()?.type).toBe('text');

    buttonWithText(host(), 'Ocultar').click();
    await harness.fixture.whenStable();
    expect(password()?.type).toBe('password');
  });
});
