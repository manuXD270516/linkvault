import { InjectionToken } from '@angular/core';
import type { SessionResponse } from '@linkvault/shared';

/** Nombre del lock de Web Locks que serializa los refresh de todas las pestañas del mismo origen (D11). */
export const REFRESH_LOCK_NAME = 'lv-refresh';

/**
 * Subconjunto de `LockManager` que usa el refresh. `navigator.locks` lo cumple; los tests inyectan un doble.
 */
export interface RefreshLockManager {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<SessionResponse>,
  ): Promise<SessionResponse>;
}

/** Web Locks del navegador o `null` si no existen: entonces el refresh se degrada a single-flight por pestaña. */
export const REFRESH_LOCKS = new InjectionToken<RefreshLockManager | null>('REFRESH_LOCKS', {
  providedIn: 'root',
  factory: () =>
    typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
});

/** Reintentos ante `409 refresh_conflict`: esperas base y variación relativa (ADR-020 §3). */
export interface RefreshRetryPolicy {
  /** Una espera por reintento; su longitud es el número máximo de reintentos. */
  readonly delaysMs: readonly number[];
  /** Variación aleatoria relativa: 0.5 = ±50 %. */
  readonly jitterRatio: number;
  /** Aleatorio en [0, 1). */
  readonly random: () => number;
  /** Espera `ms` o rechaza con el motivo del `signal` si se aborta. */
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const DEFAULT_REFRESH_RETRY_POLICY: RefreshRetryPolicy = {
  delaysMs: [250, 500, 1000],
  jitterRatio: 0.5,
  random: () => Math.random(),
  sleep: abortableSleep,
};

export const REFRESH_RETRY_POLICY = new InjectionToken<RefreshRetryPolicy>(
  'REFRESH_RETRY_POLICY',
  { providedIn: 'root', factory: () => DEFAULT_REFRESH_RETRY_POLICY },
);

/** Espera base ± `jitterRatio`: con `random` en [0, 1) el resultado queda en [base·(1−r), base·(1+r)). */
export function jitteredDelay(baseMs: number, jitterRatio: number, random: number): number {
  return Math.round(baseMs * (1 + jitterRatio * (2 * random - 1)));
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Rechaza con el motivo del aborto en cuanto `signal` se aborta, sin cancelar `promise`. */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function isAbortError(error: unknown): boolean {
  // Por nombre y no por `instanceof`: el `DOMException` del motivo puede venir de otro realm (jsdom en los tests).
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

export function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
