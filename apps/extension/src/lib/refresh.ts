/**
 * Reintentos ante `409 refresh_conflict`: mismas esperas base que el SPA (`delaysMs` de
 * `DEFAULT_REFRESH_RETRY_POLICY` en `web/auth`).
 */
export const REFRESH_RETRY_DELAYS_MS: readonly number[] = [250, 500, 1000];

export interface RefreshRetryPolicy {
  readonly delaysMs: readonly number[];
  readonly jitterRatio: number;
  readonly random: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_REFRESH_RETRY_POLICY: RefreshRetryPolicy = {
  delaysMs: REFRESH_RETRY_DELAYS_MS,
  jitterRatio: 0.5,
  random: () => Math.random(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Espera base ± `jitterRatio`: con `random` en [0, 1) queda en [base·(1−r), base·(1+r)). */
export function jitteredDelay(
  baseMs: number,
  jitterRatio: number,
  random: number,
): number {
  return Math.round(baseMs * (1 + jitterRatio * (2 * random - 1)));
}

/**
 * Serializa llamadas concurrentes a una sola promesa in-flight (mutex de refresh).
 * Quien llega mientras hay vuelo reutiliza la misma promesa.
 */
export function createSingleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight !== null) {
      return inFlight;
    }
    const flight = run().finally(() => {
      if (inFlight === flight) {
        inFlight = null;
      }
    });
    inFlight = flight;
    return flight;
  };
}

export interface RefreshWithRetriesOptions<T> {
  refreshOnce: () => Promise<T>;
  isConflict: (error: unknown) => boolean;
  policy?: RefreshRetryPolicy;
  /** Tras agotar los reintentos 409 (antes de relanzar el último error). */
  onRetriesExhausted?: () => Promise<void>;
}

/**
 * Ejecuta refresh; ante `409` reintenta hasta `delaysMs.length` veces (3 con la política por defecto)
 * y luego falla pidiendo re-login vía `onRetriesExhausted`.
 */
export async function refreshWithRetries<T>(
  options: RefreshWithRetriesOptions<T>,
): Promise<T> {
  const policy = options.policy ?? DEFAULT_REFRESH_RETRY_POLICY;
  const { delaysMs, jitterRatio, random, sleep } = policy;
  for (let attempt = 0; ; attempt++) {
    try {
      return await options.refreshOnce();
    } catch (error: unknown) {
      if (!options.isConflict(error)) {
        throw error;
      }
      const baseDelay = delaysMs[attempt];
      if (baseDelay === undefined) {
        await options.onRetriesExhausted?.();
        throw error;
      }
      await sleep(jitteredDelay(baseDelay, jitterRatio, random()));
    }
  }
}
