import { describe, expect, it, vi } from 'vitest';
import {
  createSingleFlight,
  jitteredDelay,
  refreshWithRetries,
  REFRESH_RETRY_DELAYS_MS,
  type RefreshRetryPolicy,
} from './refresh';

describe('createSingleFlight', () => {
  it('comparte una sola promesa in-flight entre llamadas concurrentes', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const gate = deferred<void>();

    const run = createSingleFlight(async () => {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
      return 'ok';
    });

    const first = run();
    const second = run();
    expect(runs).toBe(1);
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
    expect(runs).toBe(1);
    expect(maxActive).toBe(1);

    await expect(run()).resolves.toBe('ok');
    expect(runs).toBe(2);
  });
});

describe('refreshWithRetries', () => {
  it('usa delaysMs del SPA y se detiene tras 3 reintentos 409', async () => {
    const waits: number[] = [];
    const policy: RefreshRetryPolicy = {
      delaysMs: REFRESH_RETRY_DELAYS_MS,
      jitterRatio: 0.5,
      random: () => 0.5,
      sleep: async (ms) => {
        waits.push(ms);
      },
    };
    const refreshOnce = vi.fn(async () => {
      throw { status: 409, code: 'refresh_conflict' };
    });
    const onRetriesExhausted = vi.fn(async () => undefined);

    await expect(
      refreshWithRetries({
        refreshOnce,
        isConflict: (error) =>
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          (error as { status: number }).status === 409,
        policy,
        onRetriesExhausted,
      }),
    ).rejects.toEqual({ status: 409, code: 'refresh_conflict' });

    expect(refreshOnce).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([
      jitteredDelay(250, 0.5, 0.5),
      jitteredDelay(500, 0.5, 0.5),
      jitteredDelay(1000, 0.5, 0.5),
    ]);
    expect(onRetriesExhausted).toHaveBeenCalledTimes(1);
  });

  it('devuelve el resultado en cuanto un intento no es conflicto', async () => {
    const policy: RefreshRetryPolicy = {
      delaysMs: REFRESH_RETRY_DELAYS_MS,
      jitterRatio: 0,
      random: () => 0,
      sleep: async () => undefined,
    };
    const refreshOnce = vi
      .fn()
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce('token');

    await expect(
      refreshWithRetries({
        refreshOnce,
        isConflict: (error) =>
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          (error as { status: number }).status === 409,
        policy,
      }),
    ).resolves.toBe('token');
    expect(refreshOnce).toHaveBeenCalledTimes(2);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
