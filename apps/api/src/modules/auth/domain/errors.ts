// Errores de dominio del módulo `auth` (spec auth/credentials y auth/sessions). Cada uno lleva el código de la API que le
// corresponde; el filtro de errores de presentación decide el estado HTTP. Nunca llevan emails, contraseñas, hashes ni
// tokens: pueden acabar en un log.

/** Códigos de `apiErrorCodeSchema` que produce el dominio de `auth`. */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'too_many_attempts'
  | 'invalid_refresh'
  | 'refresh_conflict'
  | 'unauthorized'
  | 'validation_error'
  | 'invalid_token';

export abstract class AuthError extends Error {
  abstract readonly code: AuthErrorCode;
}

/** Email inexistente o contraseña incorrecta: mismo error y mismo mensaje en ambos casos (401). */
export class InvalidCredentials extends AuthError {
  override readonly name = 'InvalidCredentials';
  readonly code = 'invalid_credentials';

  constructor() {
    super('Invalid email or password');
  }
}

/** Ya existe una cuenta con ese email normalizado (409). */
export class EmailTaken extends AuthError {
  override readonly name = 'EmailTaken';
  readonly code = 'email_taken';

  constructor() {
    super('Email already registered');
  }
}

/** Límite de intentos superado (429). `retryAfterSeconds` va a la cabecera `Retry-After`, entero y como mínimo 1. */
export class TooManyAttempts extends AuthError {
  override readonly name = 'TooManyAttempts';
  readonly code = 'too_many_attempts';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many attempts');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

/** Motivo interno de un refresh rechazado; la respuesta es la misma en todos los casos. */
export type InvalidRefreshReason =
  | 'missing_token'
  | 'unknown_token'
  | 'token_expired'
  | 'session_missing'
  | 'session_expired'
  | 'session_revoked'
  | 'reused';

/** Refresh token ausente, desconocido, caducado, reusado o de una sesión revocada (401, borra la cookie). */
export class InvalidRefresh extends AuthError {
  override readonly name = 'InvalidRefresh';
  readonly code = 'invalid_refresh';

  constructor(readonly reason: InvalidRefreshReason) {
    super(`Invalid refresh token (${reason})`);
  }
}

/** Refresh token rotado hace menos de 10 s: otra petición del mismo navegador ganó la rotación (409, ADR-020). */
export class RefreshConflict extends AuthError {
  override readonly name = 'RefreshConflict';
  readonly code = 'refresh_conflict';

  constructor() {
    super('Refresh token was just rotated');
  }
}

/** Access token ausente, mal firmado, caducado, de un usuario inexistente o anterior al último cambio de contraseña (401). */
export class InvalidAccessToken extends AuthError {
  override readonly name = 'InvalidAccessToken';
  readonly code = 'unauthorized';

  constructor() {
    super('Invalid access token');
  }
}

/** Token de verificación o reset ausente, inválido, usado o caducado (400; mismo cuerpo). */
export class InvalidEmailToken extends AuthError {
  override readonly name = 'InvalidEmailToken';
  readonly code = 'invalid_token';

  constructor() {
    super('Invalid or expired token');
  }
}

/** Incumplimientos de la política de contraseñas. */
export type PasswordViolation = 'too_short' | 'too_long' | 'matches_email';

/** Campo de la petición que contiene la contraseña evaluada. */
export type PasswordField = 'password' | 'newPassword';

/** Contraseña fuera de la política (400 nombrando `field`). */
export class PasswordPolicyViolation extends AuthError {
  override readonly name = 'PasswordPolicyViolation';
  readonly code = 'validation_error';

  constructor(
    readonly field: PasswordField,
    readonly violation: PasswordViolation,
  ) {
    super(`Password policy violation in "${field}" (${violation})`);
  }
}
