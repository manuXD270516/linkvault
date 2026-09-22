import type { UserProfile } from '@linkvault/shared';

// Puerto de cuentas de usuario (D1 de auth-users). `auth` no toca la colección `users`: la usa a través de este puerto,
// que implementa un adaptador sobre el `UsersFacade` del módulo `users`. Solo tipos y el token.

export const USER_ACCOUNTS = Symbol('USER_ACCOUNTS');

export interface AccountCredentials {
  readonly userId: string;
  /** Normalizado. */
  readonly email: string;
  readonly passwordHash: string;
}

export interface AccountAuthState {
  readonly userId: string;
  readonly passwordChangedAt: Date;
}

export interface NewAccount {
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
}

export interface UserAccounts {
  /** Normaliza el email. `null` si no hay cuenta. */
  findCredentialsByEmail(email: string): Promise<AccountCredentials | null>;
  /** Alta en una sola escritura con el perfil por defecto. Rechaza con `EmailTaken` si el email ya existe. */
  createWithPassword(account: NewAccount): Promise<UserProfile>;
  /** Sustituye el hash y fija `passwordChangedAt` al instante actual. */
  setPasswordHash(
    userId: string,
    passwordHash: string,
    session?: object,
  ): Promise<void>;
  /** Marca el email verificado (UsersFacade; auth no escribe `users`). */
  markEmailVerified(userId: string, session?: object): Promise<void>;
  getAuthState(userId: string): Promise<AccountAuthState | null>;
  getProfile(userId: string): Promise<UserProfile | null>;
}
