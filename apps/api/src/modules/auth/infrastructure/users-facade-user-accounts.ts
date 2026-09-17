import type { UserProfile } from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { UsersFacade } from '../../users/application/users.facade';
import { EmailAlreadyRegistered } from '../../users/domain/errors';
import type {
  AccountAuthState,
  AccountCredentials,
  NewAccount,
  UserAccounts,
} from '../application/ports/user-accounts.port';
import { EmailTaken } from '../domain/errors';

/**
 * Adaptador USER_ACCOUNTS sobre el `UsersFacade` que exporta `UsersModule` (D1 de auth-users). `auth` nunca toca la
 * colección `users`; el error de email duplicado de `users` se traduce al del dominio de `auth`.
 */
@Injectable()
export class UsersFacadeUserAccounts implements UserAccounts {
  constructor(private readonly users: UsersFacade) {}

  findCredentialsByEmail(email: string): Promise<AccountCredentials | null> {
    return this.users.findCredentialsByEmail(email);
  }

  async createWithPassword(account: NewAccount): Promise<UserProfile> {
    try {
      return await this.users.createWithPassword(account);
    } catch (error) {
      if (error instanceof EmailAlreadyRegistered) {
        throw new EmailTaken();
      }
      throw error;
    }
  }

  setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    return this.users.setPasswordHash(userId, passwordHash);
  }

  getAuthState(userId: string): Promise<AccountAuthState | null> {
    return this.users.getAuthState(userId);
  }

  getProfile(userId: string): Promise<UserProfile | null> {
    return this.users.getProfile(userId);
  }
}
