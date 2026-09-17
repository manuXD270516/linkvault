import { Inject, Injectable } from '@nestjs/common';
import { LOGIN_ATTEMPTS_PER_EMAIL } from '../domain/attempt-limits';
import {
  InvalidAccessToken,
  InvalidCredentials,
  TooManyAttempts,
} from '../domain/errors';
import { assertPasswordPolicy } from '../domain/password-policy';
import {
  ATTEMPT_LIMITER,
  type AttemptLimiter,
} from './ports/attempt-limiter.port';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.port';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './ports/session-repository.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';

export interface ChangePasswordInput {
  /** `sub` del access token de la petición. */
  readonly userId: string;
  /** `sid` del access token: la única sesión que se conserva. */
  readonly sessionId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
}

/**
 * `POST /api/auth/password` (spec auth/credentials). Aplica la política a la nueva contraseña (incluida "distinta del
 * email", que el contrato no puede comprobar), cuenta el intento en el límite del email del usuario, verifica la actual,
 * revoca las demás sesiones y **después** guarda el nuevo hash: si la revocación falla, la contraseña no cambia. Guardar
 * el hash fija `passwordChangedAt`, que invalida los access tokens anteriores (D3).
 */
@Injectable()
export class ChangePassword {
  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute(input: ChangePasswordInput): Promise<void> {
    const user = await this.accounts.getProfile(input.userId);
    if (!user) {
      throw new InvalidAccessToken();
    }
    assertPasswordPolicy({
      password: input.newPassword,
      email: user.email,
      field: 'newPassword',
    });

    const emailKey = { kind: 'login-email', email: user.email } as const;
    const attempt = await this.limiter.consume(
      emailKey,
      LOGIN_ATTEMPTS_PER_EMAIL,
    );
    if (!attempt.allowed) {
      throw new TooManyAttempts(attempt.retryAfterSeconds);
    }

    const credentials = await this.accounts.findCredentialsByEmail(user.email);
    if (!credentials) {
      throw new InvalidAccessToken();
    }
    const matches = await this.hasher.verify(
      credentials.passwordHash,
      input.currentPassword,
    );
    if (!matches) {
      throw new InvalidCredentials();
    }

    const newHash = await this.hasher.hash(input.newPassword);
    await this.sessions.revokeUserSessionsExcept(input.userId, input.sessionId);
    await this.accounts.setPasswordHash(input.userId, newHash);
    await this.limiter.reset(emailKey);
  }
}
