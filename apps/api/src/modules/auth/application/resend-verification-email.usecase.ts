import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  VERIFY_RESEND_ATTEMPTS_PER_EMAIL,
  VERIFY_RESEND_ATTEMPTS_PER_IP,
} from '../domain/attempt-limits';
import { InvalidAccessToken, TooManyAttempts } from '../domain/errors';
import {
  AUTH_EMAIL_ACK_MESSAGE,
  AuthEmailSender,
} from './auth-email-sender';
import {
  ATTEMPT_LIMITER,
  type AttemptLimiter,
} from './ports/attempt-limiter.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';
import type { MailLocale } from '../../../infrastructure/mail/mailer.port';

export interface ResendVerificationEmailInput {
  readonly userId: string;
  readonly ip: string;
}

/**
 * `POST /api/auth/verify-email/resend` (solo autenticado). Ignora email ajeno del body; siempre 200 genérico
 * salvo 401/429 (ADR-034 D9).
 */
@Injectable()
export class ResendVerificationEmail {
  private readonly logger = new Logger(ResendVerificationEmail.name);

  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    private readonly emailSender: AuthEmailSender,
  ) {}

  async execute(
    input: ResendVerificationEmailInput,
  ): Promise<{ message: string }> {
    const user = await this.accounts.getProfile(input.userId);
    if (!user) {
      throw new InvalidAccessToken();
    }

    const emailAttempt = await this.limiter.consume(
      { kind: 'verify-resend-email', email: user.email },
      VERIFY_RESEND_ATTEMPTS_PER_EMAIL,
    );
    if (!emailAttempt.allowed) {
      throw new TooManyAttempts(emailAttempt.retryAfterSeconds);
    }
    const ipAttempt = await this.limiter.consume(
      { kind: 'verify-resend-ip', ip: input.ip },
      VERIFY_RESEND_ATTEMPTS_PER_IP,
    );
    if (!ipAttempt.allowed) {
      throw new TooManyAttempts(ipAttempt.retryAfterSeconds);
    }

    if (!user.emailVerified) {
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
          `Verify-email resend failed: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
    }

    return { message: AUTH_EMAIL_ACK_MESSAGE };
  }
}
