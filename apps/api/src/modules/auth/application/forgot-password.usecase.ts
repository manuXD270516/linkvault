import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FORGOT_PASSWORD_ATTEMPTS_PER_EMAIL,
  FORGOT_PASSWORD_ATTEMPTS_PER_IP,
} from '../domain/attempt-limits';
import { TooManyAttempts } from '../domain/errors';
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

export interface ForgotPasswordInput {
  readonly email: string;
  readonly ip: string;
}

/**
 * `POST /api/auth/forgot-password`: siempre 200 genérico tras el límite (anti-enumeración, ADR-034 D9).
 */
@Injectable()
export class ForgotPassword {
  private readonly logger = new Logger(ForgotPassword.name);

  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    private readonly emailSender: AuthEmailSender,
  ) {}

  async execute(input: ForgotPasswordInput): Promise<{ message: string }> {
    const emailAttempt = await this.limiter.consume(
      { kind: 'forgot-email', email: input.email },
      FORGOT_PASSWORD_ATTEMPTS_PER_EMAIL,
    );
    if (!emailAttempt.allowed) {
      throw new TooManyAttempts(emailAttempt.retryAfterSeconds);
    }
    const ipAttempt = await this.limiter.consume(
      { kind: 'forgot-ip', ip: input.ip },
      FORGOT_PASSWORD_ATTEMPTS_PER_IP,
    );
    if (!ipAttempt.allowed) {
      throw new TooManyAttempts(ipAttempt.retryAfterSeconds);
    }

    const credentials = await this.accounts.findCredentialsByEmail(input.email);
    if (credentials) {
      const profile = await this.accounts.getProfile(credentials.userId);
      if (profile) {
        try {
          await this.emailSender.issueAndSend({
            userId: profile.id,
            email: profile.email,
            displayName: profile.displayName,
            locale: profile.outputLanguage as MailLocale,
            purpose: 'reset_password',
          });
        } catch (error: unknown) {
          this.logger.warn(
            `Forgot-password send failed: ${
              error instanceof Error ? error.name : 'unknown'
            }`,
          );
        }
      }
    }

    return { message: AUTH_EMAIL_ACK_MESSAGE };
  }
}
