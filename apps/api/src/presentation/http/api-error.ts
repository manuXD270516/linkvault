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
  group_not_found: 404,
  member_not_found: 404,
  forbidden: 403,
  invalid_invite_code: 404,
  group_full: 409,
  too_many_groups: 409,
  owner_cannot_leave: 409,
  invalid_url: 400,
  text_too_long: 400,
  link_not_found: 404,
  preview_field_unknown: 400,
  enrichment_not_retryable: 409,
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
  group_not_found: 'Group not found',
  member_not_found: 'Member not found',
  forbidden: 'Not allowed',
  invalid_invite_code: 'Invalid invite code',
  group_full: 'Group is full',
  too_many_groups: 'Too many groups',
  owner_cannot_leave: 'The owner cannot leave the group',
  invalid_url: 'That does not look like a job link',
  text_too_long: 'Text is too long',
  link_not_found: 'Link not found',
  preview_field_unknown: 'Unknown preview field',
  enrichment_not_retryable: 'That link cannot be read automatically',
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
