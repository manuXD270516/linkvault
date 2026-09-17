import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
} from '../../domain/invite-code';
import type { Clock } from '../ports/clock.port';
import type { GroupMemberDirectory } from '../ports/group-member-directory.port';
import type { InviteCodeGenerator } from '../ports/invite-code-generator.port';

// Dobles en memoria de los puertos pequeños de `groups` para tests de application (D11). No son adaptadores de
// producción: los reales viven en infrastructure.

export class MovableClock implements Clock {
  constructor(public current = new Date('2026-09-17T10:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Generador fijo: entrega `codes` en orden y, al agotarlos, sigue con códigos deterministas distintos entre sí. Repetir
 * un código en la lista es lo que provoca la colisión del índice único que el repositorio tiene que reintentar.
 */
export class StubInviteCodeGenerator implements InviteCodeGenerator {
  private index = 0;

  constructor(private readonly codes: readonly string[] = []) {}

  /** Cuántos códigos se han pedido: distingue un reintento de un acierto a la primera. */
  get calls(): number {
    return this.index;
  }

  generate(): string {
    const code = this.codes[this.index] ?? sequentialInviteCode(this.index);
    this.index += 1;
    return code;
  }
}

/** Código con el formato del dominio a partir de un índice: `22222222`, `22222223`, … */
export function sequentialInviteCode(index: number): string {
  let remaining = index;
  let code = '';
  for (let position = 0; position < INVITE_CODE_LENGTH; position += 1) {
    code =
      INVITE_CODE_ALPHABET.charAt(remaining % INVITE_CODE_ALPHABET.length) +
      code;
    remaining = Math.floor(remaining / INVITE_CODE_ALPHABET.length);
  }
  return code;
}

/** Directorio de nombres visibles en memoria. Un id que nadie registró no aparece en el mapa, como el real. */
export class InMemoryMemberDirectory implements GroupMemberDirectory {
  private readonly names = new Map<string, string>();

  set(userId: string, displayName: string): this {
    this.names.set(userId, displayName);
    return this;
  }

  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const userId of new Set(userIds)) {
      const displayName = this.names.get(userId);
      if (displayName !== undefined) {
        found.set(userId, displayName);
      }
    }
    return Promise.resolve(found);
  }
}
