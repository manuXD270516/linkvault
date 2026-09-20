import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { SessionStore } from './core/auth/session.store';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
  });

  it('renders the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('router-outlet')).not.toBeNull();
  });

  it('shows "Conectando…" until the session status is known', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Conectando…');

    TestBed.inject(SessionStore).clear();
    await fixture.whenStable();

    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('never shows "Conectando…" when the SPA starts on the public job view', async () => {
    // En una ruta pública no se restaura la sesión al arrancar (D9), así que `unknown` no es una espera que contar.
    history.replaceState({}, '', '/oferta/k3m9qrtv2xyz');
    try {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const host = fixture.nativeElement as HTMLElement;

      expect(TestBed.inject(SessionStore).status()).toBe('unknown');
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(host.querySelector('router-outlet')).not.toBeNull();
    } finally {
      history.replaceState({}, '', '/');
    }
  });
});
