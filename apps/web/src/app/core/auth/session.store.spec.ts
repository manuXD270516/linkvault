import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AiConsent, SessionResponse, UserProfile } from '@linkvault/shared';
import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import { authInterceptor } from './auth.interceptor';
import { REFRESH_LOCKS } from './refresh-coordination';
import { SessionStore } from './session.store';

const baseConsent: AiConsent = {
  externalProviders: false,
  consentedAt: null,
  textVersion: null,
  currentTextVersion: AI_CONSENT_TEXT_VERSION,
};

function userWith(aiConsent: AiConsent): UserProfile {
  return {
    id: 'u1',
    email: 'ana@example.com',
    displayName: 'Ana',
    aiConsent,
    outputLanguage: 'es',
    redactName: true,
    createdAt: '2026-09-17T10:00:00.000Z',
  };
}

const user = userWith(baseConsent);

const session: SessionResponse = { accessToken: 'token-1', expiresIn: 900, user };

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: REFRESH_LOCKS, useValue: null },
      ],
    });
    store = TestBed.inject(SessionStore);
  });

  it('starts with an unknown status and no session', () => {
    expect(store.status()).toBe('unknown');
    expect(store.accessToken()).toBeNull();
    expect(store.expiresAt()).toBeNull();
    expect(store.user()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.consentIsCurrent()).toBe('unknown');
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
    expect(store.consentIsCurrent()).toBe('unknown');
  });

  it('keeps the token only in memory', () => {
    localStorage.clear();
    sessionStorage.clear();

    store.setSession(session, 0);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  describe('consentIsCurrent', () => {
    it.each([
      [
        'current',
        {
          externalProviders: true,
          consentedAt: '2026-09-18T10:00:00.000Z',
          textVersion: AI_CONSENT_TEXT_VERSION,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
        'current',
      ],
      [
        'outdated when revoked',
        {
          externalProviders: false,
          consentedAt: null,
          textVersion: null,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
        'outdated',
      ],
      [
        'outdated when textVersion differs',
        {
          externalProviders: true,
          consentedAt: '2026-09-18T10:00:00.000Z',
          textVersion: '2026-01-01',
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
        'outdated',
      ],
      [
        'unknown before load',
        null,
        'unknown',
      ],
    ] as const)('%s', (_label, aiConsent, expected) => {
      if (aiConsent === null) {
        expect(store.consentIsCurrent()).toBe('unknown');
        return;
      }
      store.setSession({ ...session, user: userWith(aiConsent) }, 0);
      expect(store.consentIsCurrent()).toBe(expected);
    });

    it('does not flip externalProviders when text versions differ', () => {
      const mismatched: AiConsent = {
        externalProviders: true,
        consentedAt: '2026-09-18T10:00:00.000Z',
        textVersion: '2026-01-01',
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      };
      store.setSession({ ...session, user: userWith(mismatched) }, 0);

      expect(store.consentIsCurrent()).toBe('outdated');
      expect(store.user()?.aiConsent.externalProviders).toBe(true);
      expect(store.user()?.aiConsent).toEqual(mismatched);
    });

    it('reloadConsent resolves the unknown state', async () => {
      const http = TestBed.inject(HttpTestingController);
      store.setSession(session, 0);

      const failing = store.reloadConsent();
      expect(store.consentLoading()).toBe(true);
      expect(store.consentIsCurrent()).toBe('unknown');
      http.expectOne('/api/users/me').flush(
        { code: 'internal_error', message: 'internal_error' },
        { status: 500, statusText: '500' },
      );
      await failing;
      expect(store.consentIsCurrent()).toBe('unknown');
      expect(store.consentLoadStatus()).toBe('failed');
      expect(store.consentLoading()).toBe(false);

      const reloading = store.reloadConsent();
      expect(store.consentLoading()).toBe(true);
      expect(store.consentIsCurrent()).toBe('unknown');

      http.expectOne('/api/users/me').flush(
        userWith({
          externalProviders: true,
          consentedAt: '2026-09-18T10:00:00.000Z',
          textVersion: AI_CONSENT_TEXT_VERSION,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        }),
      );
      await reloading;

      expect(store.consentLoading()).toBe(false);
      expect(store.consentIsCurrent()).toBe('current');
      expect(store.consentLoadStatus()).toBe('ready');
      http.verify();
    });
  });
});
