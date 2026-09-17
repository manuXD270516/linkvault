/** Tiempo máximo de cada comprobación de salud (D9). */
export const HEALTH_CHECK_TIMEOUT_MS = 500;

export class HealthTimeoutError extends Error {
  override readonly name = 'HealthTimeoutError';

  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs} ms`);
  }
}

/**
 * Resuelve con `work` o rechaza a los `timeoutMs`, lo que ocurra antes, sin esperar al driver: la operación
 * perdedora sigue su curso y su resultado se descarta.
 */
export function withTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const pending = Promise.resolve().then(work);
  // Si pierde la carrera y luego falla, su rechazo no debe quedar sin manejar.
  pending.catch(() => undefined);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new HealthTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}
