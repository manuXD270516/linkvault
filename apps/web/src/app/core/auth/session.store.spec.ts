import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import { SessionStore } from './session.store';

const user: UserProfile = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
  aiConsent: { externalProviders: false },
  outputLanguage: 'es',
  redactName: false,
  createdAt: '2026-09-17T10:00:00.000Z',
};

const session: SessionResponse = { accessToken: 'token-1', expiresIn: 900, user };

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    store = TestBed.inject(SessionStore);
  });

  it('starts with an unknown status and no session', () => {
    expect(store.status()).toBe('unknown');
    expect(store.accessToken()).toBeNull();
    expect(store.expiresAt()).toBeNull();
    expect(store.user()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('stores the session and computes the expiry from expiresIn', () => {
    store.setSession(session, 1_000);

    expect(store.status()).toBe('authenticated');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('token-1');
    expect(store.expiresAt()).toBe(1_000 + 900_000);
    expect(store.user()).toEqual(user);
  });

  it('replaces the user without touching the token', () => {
    store.setSession(session, 0);
    store.setUser({ ...user, displayName: 'Ana María' });

    expect(store.user()?.displayName).toBe('Ana María');
    expect(store.accessToken()).toBe('token-1');
  });

  it('clears the session and becomes anonymous', () => {
    store.setSession(session, 0);
    store.clear();

    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
    expect(store.expiresAt()).toBeNull();
    expect(store.user()).toBeNull();
  });

  it('keeps the token only in memory', () => {
    localStorage.clear();
    sessionStorage.clear();

    store.setSession(session, 0);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
