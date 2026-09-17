import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  buttonWithText,
  flushGroupDetail,
  flushGroupsList,
  providePageTesting,
  sessionWith,
  settle,
  typeInto,
} from '../../../testing/auth-testing';
import { SessionStore } from '../../core/auth/session.store';

describe('JoinGroupPage', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: SessionStore;
  let harness: RouterTestingHarness;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(SessionStore);
  });

  afterEach(() => http.verify());

  /** El diálogo se abre en el overlay, fuera del árbol del componente. */
  function dialog(): HTMLElement {
    const container = document.body.querySelector<HTMLElement>('mat-dialog-container');
    if (!container) {
      throw new Error('Dialog not opened');
    }
    return container;
  }

  function code(): string | undefined {
    return dialog().querySelector<HTMLInputElement>('input[formControlName="code"]')?.value;
  }

  function host(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  it('opens an empty form when the link carries no code', async () => {
    store.setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/unirse');
    await settle();
    await harness.fixture.whenStable();

    expect(code()).toBe('');

    // Cerrar el diálogo sin unirse devuelve a la lista.
    buttonWithText(dialog(), 'Cancelar').click();
    await vi.waitFor(() => expect(router.url).toBe('/grupos'));
    await flushGroupsList(http);
  });

  it('Enlace de invitación', async () => {
    store.setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/unirse?codigo=ABCD2345');
    await settle();
    await harness.fixture.whenStable();

    expect(code()).toBe('ABCD2345');
  });

  it('El código no queda en la URL', async () => {
    store.setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/unirse?codigo=ABCD2345');
    await settle();
    await harness.fixture.whenStable();

    expect(router.url).toBe('/unirse');
    expect(code()).toBe('ABCD2345');
  });

  it('Enlace de invitación sin sesión', async () => {
    store.clear();
    harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/unirse?codigo=ABCD2345');
    expect(router.url).toBe('/login?returnUrl=%2Funirse%3Fcodigo%3DABCD2345');

    typeInto(host(), 'input[formControlName="email"]', 'ana@example.com');
    typeInto(host(), 'input[formControlName="password"]', 'contraseña-larga');
    buttonWithText(host(), 'Entrar').click();
    await settle();
    http.expectOne('/api/auth/login').flush(sessionWith('token-1'));

    await vi.waitFor(() => expect(code()).toBe('ABCD2345'));
    expect(router.url).toBe('/unirse');
  });

  it('Enlace de invitación sin cuenta', async () => {
    store.clear();
    harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/unirse?codigo=ABCD2345');
    host().querySelector<HTMLAnchorElement>('a[href^="/registro"]')?.click();
    await vi.waitFor(() =>
      expect(router.url).toBe('/registro?returnUrl=%2Funirse%3Fcodigo%3DABCD2345'),
    );
    await harness.fixture.whenStable();

    typeInto(host(), 'input[formControlName="displayName"]', 'Ana');
    typeInto(host(), 'input[formControlName="email"]', 'ana@example.com');
    typeInto(host(), 'input[formControlName="password"]', 'contraseña-larga');
    buttonWithText(host(), 'Crear cuenta').click();
    await settle();
    http
      .expectOne('/api/auth/register')
      .flush(sessionWith('token-1'), { status: 201, statusText: 'Created' });

    await vi.waitFor(() => expect(code()).toBe('ABCD2345'));
    expect(router.url).toBe('/unirse');
  });

  it('joins from the invitation link with the same use case as the dialog', async () => {
    store.setSession(sessionWith('token-1'));
    harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/unirse?codigo=ABCD2345');
    await settle();
    await harness.fixture.whenStable();

    buttonWithText(dialog(), 'Unirme').click();
    await settle();
    const request = http.expectOne('/api/groups/join');
    expect(request.request.body).toEqual({ code: 'ABCD2345' });
    request.flush({
      id: 'g2',
      name: 'Frontend Bolivia',
      role: 'member',
      memberCount: 4,
      joinedAt: '2026-09-17T11:00:00.000Z',
    });
    await settle();
    await flushGroupsList(http);

    await vi.waitFor(() => expect(router.url).toBe('/grupos/g2'));
    await flushGroupDetail(http, {
      id: 'g2',
      name: 'Frontend Bolivia',
      role: 'member',
      memberCount: 4,
      createdAt: '2026-09-10T12:00:00.000Z',
    });
  });
});
