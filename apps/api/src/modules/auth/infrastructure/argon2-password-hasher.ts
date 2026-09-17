import { randomBytes } from 'node:crypto';
import * as argon2 from '@node-rs/argon2';
import type { PasswordHasher } from '../application/ports/password-hasher.port';

// Adaptador PASSWORD_HASHER con @node-rs/argon2 (D6 de auth-users, ADR-012): binario napi precompilado, sin toolchain
// nativa. `needsRehash` no se implementa hasta que cambien los parámetros.

/**
 * Parámetros mínimos de OWASP para Argon2id. `Algorithm` es un `const enum` de TypeScript que el paquete exporta vacío
 * en tiempo de ejecución, así que se usa su valor numérico (`Algorithm.Argon2id = 2`); el test comprueba el prefijo.
 */
export const ARGON2_OPTIONS = {
  algorithm: 2 as argon2.Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const satisfies argon2.Options;

/** Funciones de @node-rs/argon2 que usa el adaptador; inyectables para contar llamadas en tests. */
export interface Argon2Functions {
  hash(password: string, options: argon2.Options): Promise<string>;
  verify(hashed: string, password: string): Promise<boolean>;
}

const nodeRsArgon2: Argon2Functions = {
  hash: (password, options) => argon2.hash(password, options),
  verify: (hashed, password) => argon2.verify(hashed, password),
};

export class Argon2PasswordHasher implements PasswordHasher {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly argon2Functions: Argon2Functions = nodeRsArgon2,
  ) {
    // Hash ficticio de un valor aleatorio que nadie conoce, calculado una sola vez al crear el adaptador (arranque).
    this.dummyHash = argon2Functions.hash(
      randomBytes(32).toString('base64url'),
      ARGON2_OPTIONS,
    );
    // Si falla, `verifyDummy` rechaza al esperarlo; esto solo evita un `unhandledRejection` mientras nadie lo espera.
    this.dummyHash.catch(() => undefined);
  }

  hash(password: string): Promise<string> {
    return this.argon2Functions.hash(password, ARGON2_OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return this.argon2Functions.verify(passwordHash, password);
  }

  async verifyDummy(password: string): Promise<void> {
    await this.argon2Functions.verify(await this.dummyHash, password);
  }
}
