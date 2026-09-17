import {
  PasswordPolicyViolation,
  type PasswordField,
  type PasswordViolation,
} from './errors';

// Política de contraseñas (spec auth/credentials, D8 de auth-users). El contrato de `@linkvault/shared` la aplica en la
// frontera HTTP; el dominio la reaplica en registro y cambio de contraseña, y añade "distinta del email" en el cambio,
// donde la petición no trae el email. Longitud en code points (un emoji cuenta 1), el mismo criterio que zod 4.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Normalización del email para comparar (espacios exteriores y minúsculas). Duplica la regla de `users` a propósito:
 * el dominio de `auth` no importa otros módulos.
 */
function normalizeForComparison(email: string): string {
  return email.trim().toLowerCase();
}

/** Primer incumplimiento de la política, o `null` si la contraseña es válida. Sin reglas de composición. */
export function checkPasswordPolicy(
  password: string,
  email: string,
): PasswordViolation | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return 'too_short';
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return 'too_long';
  }
  if (password === normalizeForComparison(email)) {
    return 'matches_email';
  }
  return null;
}

/** Lanza `PasswordPolicyViolation` nombrando `field` si la contraseña incumple la política. */
export function assertPasswordPolicy(params: {
  password: string;
  email: string;
  field: PasswordField;
}): void {
  const violation = checkPasswordPolicy(params.password, params.email);
  if (violation !== null) {
    throw new PasswordPolicyViolation(params.field, violation);
  }
}
