import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import {
  EnvironmentInjector,
  createEnvironmentInjector,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import { AuthApi } from './auth.api';
import {
  REFRESH_LOCKS,
  REFRESH_LOCK_NAME,
  REFRESH_RETRY_POLICY,
  isAbortError,
  type RefreshLockManager,
  type RefreshRetryPolicy,
} from './refresh-coordination';
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

function sessionWith(accessToken: string): SessionResponse {
  return { accessToken, expiresIn: 900, user };
}

const conflictBody = { code: 'refresh_conflict', message: 'Refresh conflict' };

/** Doble de `navigator.locks`: concede el lock de uno en uno, en orden, y respeta `signal` mientras se espera. */
class FakeLockManager implements RefreshLockManager {
  readonly requestedNames: string[] = [];
  active = 0;
  maxActive = 0;
  private tail: Promise<void> = Promise.resolve();

  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<SessionResponse>,
  ): Promise<SessionResponse> {
    this.requestedNames.push(name);
    const granted = this.tail.then(async () => {
      options.signal?.throwIfAborted();
      this.active++;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        return await callback();
      } finally {
        this.active--;
      }
    });
    this.tail = granted.then(
      () => undefined,
      () => undefined,
    );
    return granted;
  }
}

/** Esperas sin tiempo real: registra cada espera y resuelve al momento, o queda pendiente hasta abortarse. */
class FakeSleep {
  readonly waits: number[] = [];
  hang = false;

  readonly sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
    this.waits.push(ms);
    if (!this.hang) {
      return Promise.resolve();
    }
    return new Promise<void>((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
}

/** Deja correr las microtareas y los callbacks encadenados antes de mirar las peticiones pendientes. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AuthApi.refresh', () => {
  let http: HttpTestingController;
  let fakeSleep: FakeSleep;

  function configure(locks: RefreshLockManager | null): void {
    fakeSleep = new FakeSleep();
    const policy: RefreshRetryPolicy = {
      delaysMs: [250, 500, 1000],
      jitterRatio: 0.5,
      random: () => 0.5,
      sleep: fakeSleep.sleep,
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: REFRESH_LOCKS, useValue: locks },
        { provide: REFRESH_RETRY_POLICY, useValue: policy },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  function pendingRefreshes(): TestRequest[] {
    return http.match('/api/auth/refresh');
  }

  function flushConflict(request: TestRequest): void {
    request.flush(conflictBody, { status: 409, statusText: 'Conflict' });
  }

  afterEach(() => http.verify());

  describe('with Web Locks', () => {
    let locks: FakeLockManager;
    let api: AuthApi;
    let store: SessionStore;

    beforeEach(() => {
      locks = new FakeLockManager();
      configure(locks);
      api = TestBed.inject(AuthApi);
      store = TestBed.inject(SessionStore);
    });

    it('shares a single refresh between two concurrent calls', async () => {
      const first = api.refresh();
      const second = api.refresh();
      await settle();

      const requests = pendingRefreshes();
      expect(requests).toHaveLength(1);
      expect(locks.requestedNames).toEqual([REFRESH_LOCK_NAME]);
      requests[0].flush(sessionWith('token-2'));

      await expect(first).resolves.toEqual(sessionWith('token-2'));
      await expect(second).resolves.toEqual(sessionWith('token-2'));
      expect(store.accessToken()).toBe('token-2');
    });

    it('starts a new refresh once the previous one has settled', async () => {
      const first = api.refresh();
      await settle();
      http.expectOne('/api/auth/refresh').flush(sessionWith('token-2'));
      await first;

      const second = api.refresh();
      await settle();
      http.expectOne('/api/auth/refresh').flush(sessionWith('token-3'));

      await expect(second).resolves.toEqual(sessionWith('token-3'));
    });

    it('Conflicto de refresh entre pestañas', async () => {
      const result = api.refresh();
      await settle();
      flushConflict(http.expectOne('/api/auth/refresh'));
      await settle();
      http.expectOne('/api/auth/refresh').flush(sessionWith('token-2'));

      await expect(result).resolves.toEqual(sessionWith('token-2'));
      expect(store.status()).toBe('authenticated');
      expect(fakeSleep.waits).toEqual([250]);
      http.expectNone('/api/auth/logout');
    });

    it('Cinco pestañas restauradas a la vez', async () => {
      const parent = TestBed.inject(EnvironmentInjector);
      const tabs = Array.from({ length: 5 }, () => {
        const injector = createEnvironmentInjector([AuthApi, SessionStore], parent);
        return { api: injector.get(AuthApi), store: injector.get(SessionStore) };
      });

      const results = tabs.map((tab) => tab.api.refresh());
      for (let index = 0; index < tabs.length; index++) {
        await settle();
        const requests = pendingRefreshes();
        expect(requests).toHaveLength(1);
        requests[0].flush(sessionWith(`token-${index}`));
      }

      await expect(Promise.all(results)).resolves.toHaveLength(5);
      expect(locks.maxActive).toBe(1);
      expect(locks.requestedNames).toEqual(Array(5).fill(REFRESH_LOCK_NAME));
      expect(tabs.every((tab) => tab.store.status() === 'authenticated')).toBe(true);
      http.expectNone('/api/auth/logout');
    });

    it('retries with jittered waits and logs out after the last 409', async () => {
      store.setSession(sessionWith('token-1'));
      const result = api.refresh();

      // Intento inicial y 3 reintentos, todos con 409.
      for (let attempt = 0; attempt < 4; attempt++) {
        await settle();
        flushConflict(http.expectOne('/api/auth/refresh'));
      }
      await settle();
      const logout = http.expectOne('/api/auth/logout');
      expect(logout.request.headers.get('X-Requested-With')).toBe('linkvault');
      expect(locks.active).toBe(1);
      logout.flush(null, { status: 204, statusText: 'No Content' });

      await expect(result).rejects.toMatchObject({
        status: 409,
        error: { code: 'refresh_conflict' },
      });
      expect(fakeSleep.waits).toEqual([250, 500, 1000]);
      expect(store.status()).toBe('anonymous');
      expect(store.accessToken()).toBeNull();
    });

    it('does not retry nor log out when the refresh is rejected with 401', async () => {
      const result = api.refresh();
      await settle();
      http
        .expectOne('/api/auth/refresh')
        .flush(
          { code: 'invalid_refresh', message: 'Invalid refresh' },
          { status: 401, statusText: 'Unauthorized' },
        );

      await expect(result).rejects.toMatchObject({ status: 401 });
      expect(fakeSleep.waits).toEqual([]);
      http.expectNone('/api/auth/logout');
    });

    it('does not start a request when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(api.refresh(controller.signal)).rejects.toSatisfy(isAbortError);
      await settle();
      http.expectNone('/api/auth/refresh');
      expect(locks.requestedNames).toEqual([]);
    });

    it('cancels the in-flight request on abort without logging out', async () => {
      const controller = new AbortController();
      const result = api.refresh(controller.signal);
      await settle();
      const request = http.expectOne('/api/auth/refresh');

      controller.abort();

      await expect(result).rejects.toSatisfy(isAbortError);
      expect(request.cancelled).toBe(true);
      await settle();
      http.expectNone('/api/auth/logout');
      expect(store.status()).toBe('unknown');
    });

    it('cancels the pending retries on abort without logging out', async () => {
      fakeSleep.hang = true;
      const controller = new AbortController();
      const result = api.refresh(controller.signal);
      await settle();
      flushConflict(http.expectOne('/api/auth/refresh'));
      await settle();

      controller.abort();

      await expect(result).rejects.toSatisfy(isAbortError);
      await settle();
      http.expectNone('/api/auth/refresh');
      http.expectNone('/api/auth/logout');
      expect(locks.active).toBe(0);
    });

    it('lets a joining caller stop waiting without cancelling the shared refresh', async () => {
      const first = api.refresh();
      const controller = new AbortController();
      const joined = api.refresh(controller.signal);
      await settle();

      controller.abort();
      await expect(joined).rejects.toSatisfy(isAbortError);

      http.expectOne('/api/auth/refresh').flush(sessionWith('token-2'));
      await expect(first).resolves.toEqual(sessionWith('token-2'));
    });
  });

  describe('without Web Locks', () => {
    it('falls back to a single flight in the tab', async () => {
      configure(null);
      const api = TestBed.inject(AuthApi);

      const first = api.refresh();
      const second = api.refresh();
      await settle();
      flushConflict(http.expectOne('/api/auth/refresh'));
      await settle();
      http.expectOne('/api/auth/refresh').flush(sessionWith('token-2'));

      await expect(first).resolves.toEqual(sessionWith('token-2'));
      await expect(second).resolves.toEqual(sessionWith('token-2'));
      expect(TestBed.inject(SessionStore).status()).toBe('authenticated');
    });
  });
});

describe('REFRESH_LOCKS', () => {
  it('is null when the browser lacks navigator.locks', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });

    expect('locks' in navigator).toBe(false);
    expect(TestBed.inject(REFRESH_LOCKS)).toBeNull();
  });
});
