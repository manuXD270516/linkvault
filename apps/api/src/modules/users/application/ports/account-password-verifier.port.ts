// Puerto del verificador de contraseña para el borrado de cuenta. Se inyecta con Argon2id desde presentation;
// application no importa el adaptador de `auth`.

export const ACCOUNT_PASSWORD_VERIFIER = Symbol('ACCOUNT_PASSWORD_VERIFIER');

export interface AccountPasswordVerifier {
  verify(passwordHash: string, password: string): Promise<boolean>;
}
