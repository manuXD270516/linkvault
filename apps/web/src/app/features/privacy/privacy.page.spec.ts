import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { providePageTesting, verifyNoPendingRequests } from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';
import { PrivacyPage } from './privacy.page';

describe('PrivacyPage', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    verifyNoPendingRequests(http);
  });

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ') ?? '';
  }

  it('Abrir /privacidad sin sesión', async () => {
    expect(TestBed.inject(SessionStore).isAuthenticated()).toBe(false);
    await harness.navigateByUrl('/privacidad', PrivacyPage);

    expect(router.url).toBe('/privacidad');
    expect(host().querySelector('[data-testid="privacy-notice"]')).not.toBeNull();
    expect(text()).toContain('Aviso de privacidad');
  });

  it('El aviso cubre los temas obligatorios', async () => {
    await harness.navigateByUrl('/privacidad', PrivacyPage);
    const body = text();

    expect(body).toMatch(/almacén de objetos|S3/i);
    expect(body).toMatch(/caducidad automática|permanece hasta/i);
    expect(body).toMatch(/IA|OpenRouter|BYOK/i);
    expect(body).toMatch(/Borrar tu cuenta|borrar tu cuenta/i);
    // D5 documenta SSE y sin lifecycle: MAY afirmar cifrado; NO SHALL inventar caducidad automática.
    expect(body).toMatch(/cifrado en reposo|SSE/i);
    expect(body).not.toMatch(/caduca solo al cabo de \d+ d[ií]as/i);
  });

  it('muestra el enlace a iniciar sesión', async () => {
    await harness.navigateByUrl('/privacidad', PrivacyPage);
    const link = host().querySelector<HTMLAnchorElement>('[data-testid="privacy-login-link"]');
    expect(link?.getAttribute('href')).toBe('/login');
  });
});
