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
