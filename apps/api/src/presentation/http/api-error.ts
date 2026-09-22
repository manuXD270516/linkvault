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
  already_owner: 409,
  invalid_url: 400,
  text_too_long: 400,
  link_not_found: 404,
  comment_not_found: 404,
  preview_field_unknown: 400,
  enrichment_not_retryable: 409,
  not_a_job_posting: 422,
  extraction_unavailable: 503,
  ai_quota_exceeded: 429,
  application_not_found: 404,
  application_conflict: 409,
  cv_not_found: 404,
  unsupported_file_type: 415,
  file_too_large: 413,
  too_many_cvs: 409,
  analysis_not_found: 404,
  no_cv: 409,
  cv_not_ready: 409,
  cv_not_readable: 409,
  job_not_ready: 409,
  roadmap_not_eligible: 409,
  consent_text_outdated: 409,
  vault_unavailable: 503,
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
  // Genérico a propósito: hasta `cv-upload-extract` este código solo lo daba una ruta que espera JSON, pero ahora lo
  // comparten dos formatos —JSON en casi todas y `multipart/form-data` en la subida del CV— y el mensaje no puede
  // mentirle a ninguna de las dos. El SPA traduce el código, no el mensaje.
  unsupported_media_type: 'Unsupported request body format',
  too_many_attempts: 'Too many attempts',
  internal_error: 'Internal server error',
  group_not_found: 'Group not found',
  member_not_found: 'Member not found',
  forbidden: 'Not allowed',
  invalid_invite_code: 'Invalid invite code',
  group_full: 'Group is full',
  too_many_groups: 'Too many groups',
  owner_cannot_leave: 'The owner cannot leave the group',
  already_owner: 'You already own this group',
  invalid_url: 'That does not look like a job link',
  text_too_long: 'Text is too long',
  link_not_found: 'Link not found',
  comment_not_found: 'Comment not found',
  preview_field_unknown: 'Unknown preview field',
  enrichment_not_retryable: 'That link cannot be read automatically',
  not_a_job_posting: 'That does not look like a job posting',
  extraction_unavailable: 'We could not read it now, try again in a while',
  ai_quota_exceeded: "You reached today's reading limit, come back tomorrow",
  application_not_found: 'Application not found',
  application_conflict: 'The application changed in another tab',
  // El CV no existe, es de otra persona o su `:id` está mal formado: el mismo cuerpo en los tres casos.
  cv_not_found: 'CV not found',
  // El archivo no es PDF ni DOCX. NO es `unsupported_media_type`: eso es "el cuerpo de la petición no es lo que esta
  // ruta lee", y la pantalla explica las dos cosas distinto.
  unsupported_file_type: 'Only PDF or DOCX files are accepted',
  file_too_large: 'That file is too large',
  too_many_cvs: 'Too many stored CVs',
  analysis_not_found: 'Analysis not found',
  no_cv: 'Upload a CV before analysing a job',
  cv_not_ready: 'That CV is still being read',
  cv_not_readable: 'That CV could not be read',
  job_not_ready: 'That job has no description yet',
  roadmap_not_eligible:
    'That analysis cannot produce a study roadmap',
  consent_text_outdated: 'The consent text changed; read it again',
  vault_unavailable: 'AI key vault is not available',
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
