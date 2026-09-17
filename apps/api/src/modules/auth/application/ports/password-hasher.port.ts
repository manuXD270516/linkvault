// Puerto de hash de contraseñas (D6 de auth-users). Solo tipos y el token.

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
  /** Hash Argon2id con sal aleatoria por llamada, en formato PHC (`$argon2id$...`). */
  hash(password: string): Promise<string>;
  /** `true` si `password` corresponde a `passwordHash`. */
  verify(passwordHash: string, password: string): Promise<boolean>;
  /**
   * Verificación real contra un hash ficticio calculado al arrancar, con el mismo coste que `verify`. El login la usa
   * cuando el email no existe, para que el tiempo de respuesta no delate si la cuenta existe. Nunca coincide.
   */
  verifyDummy(password: string): Promise<void>;
}
