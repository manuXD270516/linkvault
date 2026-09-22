import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidAccountPassword,
  UserNotFound,
} from '../domain/errors';
import {
  ACCOUNT_DELETION_CASCADE,
  type AccountDeletionCascade,
} from './ports/account-deletion-cascade.port';
import {
  ACCOUNT_PASSWORD_VERIFIER,
  type AccountPasswordVerifier,
} from './ports/account-password-verifier.port';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './ports/user-repository.port';

/**
 * `DELETE /api/users/me` (spec users/account-deletion): reintroduce la contraseña y, si coincide, ejecuta la cascada
 * atómica (D4/D11). Sin sesión válida el guard responde 401 antes; usuario fantasma → `UserNotFound` → 401.
 */
@Injectable()
export class DeleteAccount {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ACCOUNT_PASSWORD_VERIFIER)
    private readonly passwords: AccountPasswordVerifier,
    @Inject(ACCOUNT_DELETION_CASCADE)
    private readonly cascade: AccountDeletionCascade,
  ) {}

  async execute(userId: string, password: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (user === null) {
      throw new UserNotFound(userId);
    }
    const matches = await this.passwords.verify(user.passwordHash, password);
    if (!matches) {
      throw new InvalidAccountPassword();
    }
    await this.cascade.execute(userId);
  }
}
