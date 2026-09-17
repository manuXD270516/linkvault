import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionStore } from '../../core/auth/session.store';
import { HomePage } from './home.page';

describe('HomePage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('greets the user by display name', async () => {
    TestBed.inject(SessionStore).setSession({
      accessToken: 'token-1',
      expiresIn: 900,
      user: {
        id: 'u1',
        email: 'ana@example.com',
        displayName: 'Ana',
        aiConsent: { externalProviders: false },
        outputLanguage: 'es',
        redactName: false,
        createdAt: '2026-09-17T10:00:00.000Z',
      },
    });
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Hola, Ana');
  });
});
