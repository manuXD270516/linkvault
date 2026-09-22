import { Inject, Injectable, Logger } from '@nestjs/common';
import { REGISTRATIONS_PER_IP } from '../domain/attempt-limits';
import { TooManyAttempts } from '../domain/errors';
import { assertPasswordPolicy } from '../domain/password-policy';
import { AuthEmailSender } from './auth-email-sender';
import { type IssuedSession, SessionOpener } from './issued-session';
import {
  ATTEMPT_LIMITER,
  type AttemptLimiter,
} from './ports/attempt-limiter.port';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';
import type { MailLocale } from '../../../infrastructure/mail/mailer.port';

export interface RegisterInput {
  /** Tal como llega; se normaliza al guardarlo. */
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  /** IP del cliente (`request.ip`). */
  readonly ip: string;
}

/**
 * `POST /api/auth/register` (spec auth/credentials + email-verification). Tras crear usuario y abrir sesión,
 * intenta emitir verify + correo; fallo de mail o de persistencia del token → 201 + warning (ADR-034 D3/D11).
 */
@Injectable()
export class Register {
  private readonly logger = new Logger(Register.name);

  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    private readonly sessionOpener: SessionOpener,
    private readonly emailSender: AuthEmailSender,
  ) {}

  async execute(input: RegisterInput): Promise<IssuedSession> {
    const attempt = await this.limiter.consume(
      { kind: 'register-ip', ip: input.ip },
      REGISTRATIONS_PER_IP,
    );
    if (!attempt.allowed) {
      throw new TooManyAttempts(attempt.retryAfterSeconds);
    }

    assertPasswordPolicy({
      password: input.password,
      email: input.email,
      field: 'password',
    });
    const user = await this.accounts.createWithPassword({
      email: input.email,
      passwordHash: await this.hasher.hash(input.password),
      displayName: input.displayName,
    });
    const session = await this.sessionOpener.open(user);

    try {
      await this.emailSender.issueAndSend({
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        locale: user.outputLanguage as MailLocale,
        purpose: 'verify_email',
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Post-register verification email failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }

    return session;
  }
}
