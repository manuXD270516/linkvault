import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { SessionResponse } from '@linkvault/shared';
import { SessionStore } from '../../core/auth/session.store';
import { Shell } from './shell';

const session: SessionResponse = {
  accessToken: 'token-1',
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'ana@example.com',
    displayName: 'Ana',
    emailVerified: true,
    aiConsent: {
    externalProviders: false,
    consentedAt: null,
    textVersion: null,
    currentTextVersion: '2026-09-20',
  },
    outputLanguage: 'es',
    redactName: false,
    createdAt: '2026-09-17T10:00:00.000Z',
  },
};

@Component({ selector: 'lv-login-stub', template: 'login' })
class LoginStub {}

function logoutButton(host: HTMLElement): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((element) =>
    element.textContent?.includes('Cerrar sesión'),
  );
  if (!button) {
    throw new Error('Logout button not found');
  }
  return button;
}

describe('Shell', () => {
  let http: HttpTestingController;
  let store: SessionStore;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: LoginStub }]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
    store.setSession(session);
  });

  afterEach(() => http.verify());

  it('shows the logout button and a link to the profile', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(logoutButton(host).disabled).toBe(false);
    expect(host.querySelector('a[href="/perfil"]')?.textContent).toContain('Perfil');
  });

  it('shows a link to the private list of links', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('a[href="/mis-links"]')?.textContent).toContain('Solo para mí');
  });

  it('shows a link to my CV', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('a[href="/mi-cv"]')?.textContent).toContain('Mi CV');
  });

  it('shows a link to the applications board', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('a[href="/postulaciones"]')?.textContent).toContain('Postulaciones');
  });

  it('shows a link to search', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('a[href="/buscar"]')?.textContent).toContain('Buscar');
  });

  it('shows a link to discovery next to search', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('a[href="/descubrir"]')?.textContent).toContain('Descubrir');
  });

  it('logs out and navigates to /login', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();

    logoutButton(fixture.nativeElement as HTMLElement).click();
    http
      .expectOne('/api/auth/logout')
      .flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(router.url).toBe('/login'));
    expect(store.status()).toBe('anonymous');
  });

  it('Logout con red caída', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();

    logoutButton(fixture.nativeElement as HTMLElement).click();
    http
      .expectOne('/api/auth/logout')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    await vi.waitFor(() => expect(router.url).toBe('/login'));
    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
  });
});
