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
    // Cifrado con clave propia (object-store D7) y sin lifecycle de borrado: NO SHALL inventar caducidad automática.
    expect(body).toMatch(/se guarda cifrado/i);
    expect(body).not.toMatch(/caduca solo al cabo de \d+ d[ií]as/i);
  });

  it('El cifrado del CV se explica sin jerga ni proveedor', async () => {
    await harness.navigateByUrl('/privacidad', PrivacyPage);
    const paragraph = host().querySelector('[data-testid="privacy-cv-encryption"]');
    const encryption = paragraph?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    // object-store D7: cierto con el almacén autoalojado, tanto con cifrado del servidor como con clave del cliente.
    expect(encryption).toBe(
      'Tu CV se guarda cifrado en nuestro servidor; la clave la guardamos nosotros, aparte de los datos.',
    );
    expect(encryption).not.toMatch(/proveedor|SSE|bucket/i);
  });

  it('renders the backup notice with the four points and the documented maximum', async () => {
    await harness.navigateByUrl('/privacidad', PrivacyPage);
    const section = host().querySelector('[data-testid="privacy-backups"]');
    const body = section?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(section).not.toBeNull();
    // 1. copias cifradas con clave propia, fuera del servidor, en servicios de terceros (sin nombrar cuentas).
    expect(body).toMatch(/copias de seguridad cifradas con una clave propia/i);
    expect(body).toMatch(/fuera del servidor/i);
    expect(body).toMatch(/servicios de almacenamiento de terceros/i);
    // 2. lo borrado desaparece de inmediato de la app y de las copias en un plazo máximo, y no se puede acelerar.
    expect(body).toMatch(/de inmediato de la aplicación/i);
    expect(body).toMatch(/plazo máximo de 14 semanas/i);
    expect(body).toMatch(/no podemos acelerar/i);
    // 3. se pueden perder las últimas 24 horas.
    expect(body).toMatch(/últimas 24 horas/i);
    // 4. algo borrado justo antes de una recuperación puede volver.
    expect(body).toMatch(/justo antes de una recuperación/i);
    expect(body).toMatch(/volver/i);
    // No inventa garantías: nunca dice que lo borrado desaparece de inmediato de todas partes.
    expect(body).not.toMatch(/de inmediato de todas partes|desaparece de todas partes/i);
  });

  it('muestra el enlace a iniciar sesión', async () => {
    await harness.navigateByUrl('/privacidad', PrivacyPage);
    const link = host().querySelector<HTMLAnchorElement>('[data-testid="privacy-login-link"]');
    expect(link?.getAttribute('href')).toBe('/login');
  });
});
