import { Inject, Injectable } from '@nestjs/common';
import { InvalidEmailToken } from '../domain/errors';
import { hashEmailToken } from './email-token';
import {
  EMAIL_TOKEN_REPOSITORY,
  type EmailTokenRepository,
} from './ports/email-token-repository.port';
import { CLOCK } from './ports/clock.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';
import type { Clock } from '../domain/clock';

export interface VerifyEmailInput {
  readonly token: string;
}

/**
 * `POST /api/auth/verify-email`: consume el token y marca `emailVerified` en la misma txn (ADR-034 D14).
 */
@Injectable()
export class VerifyEmail {
  constructor(
    @Inject(EMAIL_TOKEN_REPOSITORY)
    private readonly tokens: EmailTokenRepository,
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: VerifyEmailInput): Promise<void> {
    const outcome = await this.tokens.consume(
      hashEmailToken(input.token),
      'verify_email',
      this.clock.now(),
      async (userId, session) => {
        await this.accounts.markEmailVerified(userId, session);
      },
    );
    if (outcome === 'invalid') {
      throw new InvalidEmailToken();
    }
  }
}
