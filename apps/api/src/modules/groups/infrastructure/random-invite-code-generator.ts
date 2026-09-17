import { randomInt } from 'node:crypto';
import type { InviteCodeGenerator } from '../application/ports/invite-code-generator.port';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
} from '../domain/invite-code';

/**
 * Generador real de códigos de invitación (D3): 8 símbolos del alfabeto del dominio con `randomInt` de `node:crypto`,
 * que no tiene el sesgo de módulo de `Math.random()`. Es puro: no consulta la base de datos, así que dos códigos pueden
 * coincidir; de eso se encargan el índice único y el reintento del repositorio.
 */
export class RandomInviteCodeGenerator implements InviteCodeGenerator {
  generate(): string {
    let code = '';
    for (let position = 0; position < INVITE_CODE_LENGTH; position += 1) {
      code += INVITE_CODE_ALPHABET.charAt(
        randomInt(INVITE_CODE_ALPHABET.length),
      );
    }
    return code;
  }
}
