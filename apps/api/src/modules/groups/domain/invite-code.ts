// Código de invitación (D3 de groups): 8 caracteres de un alfabeto de 30 símbolos, único entre todos los grupos, sin
// caducidad y reutilizable. Circula por WhatsApp y se teclea a mano, así que el alfabeto evita las parejas ambiguas y la
// entrada se normaliza antes de juzgarla.
//
// El formato lo valida el dominio y NO el schema de la petición: un código mal pegado responde `invalid_invite_code`
// (404, el mismo cuerpo que uno desconocido) y no el `validation_error` genérico del pipe, que el SPA no sabría explicar.

/** Base32 de Crockford sin `0`, `1`, `I`, `L`, `O` ni `U`: 30 símbolos, 30⁸ ≈ 6,6e11 combinaciones. */
export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export const INVITE_CODE_LENGTH = 8;

const INVITE_CODE_PATTERN = new RegExp(
  `^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`,
);

/** Código tal y como lo escribió la persona, listo para compararlo: sin espacios exteriores y en mayúsculas. */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Formato estricto: exactamente 8 caracteres del alfabeto. Espera un código ya normalizado (`normalizeInviteCode`);
 * juzga las minúsculas y los espacios interiores como lo que son, caracteres fuera del alfabeto.
 */
export function isValidInviteCode(code: string): boolean {
  return INVITE_CODE_PATTERN.test(code);
}
