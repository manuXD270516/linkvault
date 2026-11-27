import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import { REFRESH_LOCKS } from './refresh-coordination';
import { SESSION_RESTORE_TIMEOUT_MS, SessionRestore } from './session-restore';
import { SessionStore } from './session.store';

const user: UserProfile = {
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
};

const session: SessionResponse = { accessToken: 'token-late', expiresIn: 900, user };

describe('SessionRestore', () => {
  let http: HttpTestingController;
  let store: SessionStore;
  let restore: SessionRestore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: REFRESH_LOCKS, useValue: null },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SessionStore);
    restore = TestBed.inject(SessionRestore);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('keeps the restore request alive when the timeout fires', async () => {
    const restoring = restore.restore();
    await vi.advanceTimersByTimeAsync(0);
    const request = http.expectOne('/api/auth/refresh');

    await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS);
    await restoring;

    expect(store.status()).toBe('anonymous');
    expect(request.cancelled).toBe(false);
    http.expectNone('/api/auth/logout');
    request.flush(session);
  });

  it('ignores a late 200 from a timed-out restore', async () => {
    const restoring = restore.restore();
    await vi.advanceTimersByTimeAsync(0);
    const request = http.expectOne('/api/auth/refresh');
    await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS);
    await restoring;

    await vi.advanceTimersByTimeAsync(2_000);
    request.flush(session);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(store.status()).toBe('anonymous');
    expect(store.accessToken()).toBeNull();
    http.expectNone('/api/auth/refresh');
    http.expectNone('/api/auth/logout');
  });

  it('does not retry nor log out after a late 409 from a timed-out restore', async () => {
    const restoring = restore.restore();
    await vi.advanceTimersByTimeAsync(0);
    const request = http.expectOne('/api/auth/refresh');
    await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS);
    await restoring;

    request.flush(
      { code: 'refresh_conflict', message: 'Refresh conflict' },
      { status: 409, statusText: 'Conflict' },
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect(store.status()).toBe('anonymous');
    http.expectNone('/api/auth/refresh');
    http.expectNone('/api/auth/logout');
  });
});
