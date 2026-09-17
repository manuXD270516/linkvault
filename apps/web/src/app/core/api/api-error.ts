import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorCode } from '@linkvault/shared';

/**
 * Indica si `error` es una respuesta de la API con ese estado y ese `code` (cuerpo `{ code, message, fields? }`).
 * Solo importa tipos de `@linkvault/shared`: validar con zod aquí metería zod en el bundle inicial.
 */
export function hasApiErrorCode(error: unknown, status: number, code: ApiErrorCode): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== status) {
    return false;
  }
  const body: unknown = error.error;
  return typeof body === 'object' && body !== null && 'code' in body && body.code === code;
}

/**
 * Fallo de una petición tal como lo muestran los formularios. El SPA traduce el código, nunca el `message` de la API.
 * - `api`: respuesta con estado HTTP; `code` si el cuerpo trae uno y `retryAfterMinutes` si hay `Retry-After`.
 * - `offline`: la petición no llegó a la API (estado 0).
 */
export type RequestFailure =
  | { kind: 'api'; status: number; code: string | null; retryAfterMinutes: number | null }
  | { kind: 'offline' }
  | { kind: 'unknown' };

export function toRequestFailure(error: unknown): RequestFailure {
  if (!(error instanceof HttpErrorResponse)) {
    return { kind: 'unknown' };
  }
  if (error.status === 0) {
    return { kind: 'offline' };
  }
  const body: unknown = error.error;
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      ? body.code
      : null;
  return {
    kind: 'api',
    status: error.status,
    code,
    retryAfterMinutes: retryAfterMinutes(error.headers.get('Retry-After')),
  };
}

export function isApiFailure(
  failure: RequestFailure | null,
  status: number,
  code: ApiErrorCode,
): boolean {
  return failure?.kind === 'api' && failure.status === status && failure.code === code;
}

/** `Retry-After` en segundos convertido a minutos redondeando hacia arriba (como mínimo 1). */
export function retryAfterMinutes(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) {
    return null;
  }
  return Math.max(1, Math.ceil(Number(header.trim()) / 60));
}
