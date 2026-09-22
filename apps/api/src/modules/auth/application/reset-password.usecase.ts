import { Inject, Injectable } from '@nestjs/common';
import { InvalidEmailToken } from '../domain/errors';
import { assertPasswordPolicy } from '../domain/password-policy';
import { hashEmailToken } from './email-token';
import {
  ATTEMPT_LIMITER,
  type AttemptLimiter,
} from './ports/attempt-limiter.port';
import {
  EMAIL_TOKEN_REPOSITORY,
  type EmailTokenRepository,
} from './ports/email-token-repository.port';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.port';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './ports/session-repository.port';
import { CLOCK } from './ports/clock.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';
import type { Clock } from '../domain/clock';

export interface ResetPasswordInput {
  readonly token: string;
  readonly newPassword: string;
}

/**
 * `POST /api/auth/reset-password` (ADR-034 D8):
 * política → revokeAllUserSessions → setPasswordHash + consume (txn) → AttemptLimiter.reset(login-email).
 * Si la revocación falla, el hash no cambia.
 */
@Injectable()
export class ResetPassword {
  constructor(
    @Inject(EMAIL_TOKEN_REPOSITORY)
    private readonly tokens: EmailTokenRepository,
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: ResetPasswordInput): Promise<void> {
    const tokenHash = hashEmailToken(input.token);
    const now = this.clock.now();
    const valid = await this.tokens.findValid(
      tokenHash,
      'reset_password',
      now,
    );
    if (!valid) {
      throw new InvalidEmailToken();
    }

    const profile = await this.accounts.getProfile(valid.userId);
    if (!profile) {
      throw new InvalidEmailToken();
    }

    assertPasswordPolicy({
      password: input.newPassword,
      email: profile.email,
      field: 'newPassword',
    });

    const newHash = await this.hasher.hash(input.newPassword);

    // Orden obligatorio: revocar todas las sesiones **antes** del hash (D8).
    await this.sessions.revokeAllUserSessions(valid.userId);

    const outcome = await this.tokens.consume(
      tokenHash,
      'reset_password',
      this.clock.now(),
      async (userId, session) => {
        await this.accounts.setPasswordHash(userId, newHash, session);
      },
    );
    if (outcome === 'invalid') {
      // Carrera: token invalidado tras el peek; hash no se escribió (effect no corrió).
      throw new InvalidEmailToken();
    }

    await this.limiter.reset({ kind: 'login-email', email: profile.email });
  }
}
