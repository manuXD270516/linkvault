import { Global, Module } from '@nestjs/common';
import type { ApiConfig } from '../config/api-config.schema';
import { APP_CONFIG } from '../config/app-config.module';
import { CapturingMailer } from './capturing-mailer';
import { MAILER } from './mailer.port';
import { ResendMailer } from './resend-mailer';
import { SmtpMailer } from './smtp-mailer';

/**
 * Módulo de correo transaccional (ADR-034). Global para que `AuthModule` reciba el puerto sin re-exportarlo.
 * Selección por `MAIL_PROVIDER`: smtp / resend / capture.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: ApiConfig) => {
        switch (config.MAIL_PROVIDER) {
          case 'capture':
            return new CapturingMailer();
          case 'smtp':
            return new SmtpMailer({
              host: config.MAIL_SMTP_HOST ?? 'localhost',
              port: config.MAIL_SMTP_PORT ?? 1025,
              from: config.MAIL_FROM,
              secure: config.MAIL_SMTP_SECURE,
              user: config.MAIL_SMTP_USER,
              password: config.MAIL_SMTP_PASSWORD,
            });
          case 'resend':
            return new ResendMailer({
              apiKey: config.RESEND_API_KEY ?? '',
              from: config.MAIL_FROM,
            });
        }
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
