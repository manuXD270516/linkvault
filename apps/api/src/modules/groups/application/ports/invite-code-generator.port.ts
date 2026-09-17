// Puerto del generador de códigos de invitación (D3 de groups). El generador es puro: no consulta la base de datos, así
// que nada de check-then-insert. La unicidad la garantiza el índice único, y el reintento ante una colisión vive en el
// repositorio, que pide otro código. Un test puede fijar la secuencia con un doble.

export const INVITE_CODE_GENERATOR = Symbol('INVITE_CODE_GENERATOR');

export interface InviteCodeGenerator {
  /** Código nuevo con el formato de `domain/invite-code` (8 símbolos del alfabeto). */
  generate(): string;
}

/** Intentos del repositorio ante una colisión del índice único de `inviteCode` antes de rendirse (D3). */
export const MAX_INVITE_CODE_ATTEMPTS = 5;

/**
 * Ningún intento dio un código libre. No es un error de dominio (no tiene código de la API): el filtro lo trata como
 * cualquier error inesperado y responde 500. Con 30⁸ combinaciones, cinco colisiones seguidas señalan una avería.
 */
export class InviteCodeUnavailable extends Error {
  override readonly name = 'InviteCodeUnavailable';

  constructor() {
    super(`No free invite code after ${MAX_INVITE_CODE_ATTEMPTS} attempts`);
  }
}
