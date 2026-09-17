import type { ApiErrorCode, ApiErrorResponse } from '@linkvault/shared';

/**
 * Estado HTTP de cada código de error de la API (D5 y D8 de auth-users). Lo comparten el hook de cabeceras de auth y el
 * filtro global de errores, para que un mismo código responda siempre con el mismo estado.
 */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  validation_error: 400,
  invalid_credentials: 401,
  invalid_refresh: 401,
  unauthorized: 401,
  csrf_header_missing: 403,
  email_taken: 409,
  refresh_conflict: 409,
  unsupported_media_type: 415,
  too_many_attempts: 429,
  internal_error: 500,
};

/**
 * Mensaje fijo por código. No se reutiliza el `message` de los errores de dominio: puede llevar detalles internos (motivo
 * del refresh rechazado, id de usuario) que no deben salir en la respuesta. El SPA traduce el código, no el mensaje.
 */
export const API_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  validation_error: 'Invalid request',
  invalid_credentials: 'Invalid email or password',
  invalid_refresh: 'Invalid refresh token',
  unauthorized: 'Authentication required',
  csrf_header_missing: 'Missing X-Requested-With header',
  email_taken: 'Email already registered',
  refresh_conflict: 'Refresh token was just rotated',
  unsupported_media_type: 'Request body must be application/json',
  too_many_attempts: 'Too many attempts',
  internal_error: 'Internal server error',
};

/** Cuerpo `{ code, message, fields? }`. `fields` solo nombra campos y se omite si está vacío. */
export function apiErrorBody(
  code: ApiErrorCode,
  fields: readonly string[] = [],
): ApiErrorResponse {
  const body: ApiErrorResponse = { code, message: API_ERROR_MESSAGES[code] };
  if (fields.length > 0) {
    body.fields = [...fields];
  }
  return body;
}
