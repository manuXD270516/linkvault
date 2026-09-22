import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import {
  expiresInHuman,
} from '../../../infrastructure/mail/mail-templates';
import {
  MAILER,
  type Mailer,
  type MailLocale,
  type MailTemplateId,
} from '../../../infrastructure/mail/mailer.port';
import { generateOpaqueToken, hashEmailToken } from './email-token';
import {
  EMAIL_TOKEN_REPOSITORY,
  type EmailTokenPurpose,
  type EmailTokenRepository,
} from './ports/email-token-repository.port';
import { CLOCK } from './ports/clock.port';
import type { Clock } from '../domain/clock';

export interface SendAuthEmailInput {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale: MailLocale;
  readonly purpose: EmailTokenPurpose;
}

/**
 * Emite un token (invalidando previos del mismo purpose) y envía el correo.
 * Fallos de persistencia o de envío se propagan al llamador (registro los traga con warning).
 */
@Injectable()
export class AuthEmailSender {
  private readonly logger = new Logger(AuthEmailSender.name);

  constructor(
    @Inject(EMAIL_TOKEN_REPOSITORY)
    private readonly tokens: EmailTokenRepository,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
  ) {}

  async issueAndSend(input: SendAuthEmailInput): Promise<void> {
    const plain = generateOpaqueToken();
    const ttlSeconds =
      input.purpose === 'verify_email'
        ? this.config.AUTH_VERIFY_TOKEN_TTL_HOURS * 3600
        : this.config.AUTH_RESET_TOKEN_TTL_SECONDS;
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    await this.tokens.issue({
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashEmailToken(plain),
      expiresAt,
    });

    const templateId: MailTemplateId =
      input.purpose === 'verify_email'
        ? 'email-verification'
        : 'password-reset';
    const path =
      input.purpose === 'verify_email'
        ? '/verificar-email'
        : '/restablecer-contrasena';
    const actionUrl = `${this.config.WEB_BASE_URL}${path}?token=${encodeURIComponent(plain)}`;

    try {
      await this.mailer.send({
        to: input.email,
        templateId,
        locale: input.locale,
        variables: {
          displayName: input.displayName,
          actionUrl,
          expiresInHuman: expiresInHuman(input.locale, ttlSeconds),
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Auth email send failed for purpose=${input.purpose}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      throw error;
    }
  }
}

/** Mensaje genérico anti-enumeración (forgot y resend). */
export const AUTH_EMAIL_ACK_MESSAGE =
  'If an account exists for that email, we sent instructions.';
