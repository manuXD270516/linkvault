import { Logger } from '@nestjs/common';
import { classifySmtpRejection, smtpTransportOptions } from '@linkvault/shared';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { renderMail } from './mail-templates';
import type { Mailer, MailMessage } from './mailer.port';

export interface SmtpMailerOptions {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  /** TLS implícito (`MAIL_SMTP_SECURE=true`); por defecto, conexión en claro con STARTTLS si hay credenciales. */
  readonly secure?: boolean;
  /** `MAIL_SMTP_USER` y `MAIL_SMTP_PASSWORD`: juntas (lo garantiza el esquema) o ninguna. */
  readonly user?: string;
  readonly password?: string;
  /** CA adicional en la que confiar (la del servidor de pruebas); el resto, las del sistema. */
  readonly trustedCa?: string;
  /** Dónde se registran los rechazos; por defecto el `Logger` de Nest (pino en la aplicación). */
  readonly logger?: Pick<Logger, 'warn'>;
}

/**
 * Adaptador SMTP (`MAIL_PROVIDER=smtp`): Mailpit en local, sin autenticación, o un servidor con usuario y contraseña
 * (design D6 de `staging-host`). Con credenciales, la conexión va cifrada antes de enviarlas y el certificado se
 * verifica; las opciones salen de `smtpTransportOptions`, la misma función que usa el `worker`. Solo texto plano; no
 * registra el cuerpo, ni el usuario ni la contraseña.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly logger: Pick<Logger, 'warn'>;

  constructor(options: SmtpMailerOptions) {
    this.from = options.from;
    this.logger = options.logger ?? new Logger(SmtpMailer.name);
    this.transport = nodemailer.createTransport(
      smtpTransportOptions({
        host: options.host,
        port: options.port,
        secure: options.secure ?? false,
        user: options.user,
        password: options.password,
        trustedCa: options.trustedCa,
      }),
    );
  }

  async send(message: MailMessage): Promise<void> {
    const rendered = renderMail(
      message.templateId,
      message.locale,
      message.variables,
    );
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: rendered.subject,
        text: rendered.text,
      });
    } catch (error) {
      // Clase y código, nunca credenciales ni el texto del servidor (puede repetir el usuario).
      const rejection = classifySmtpRejection(error);
      this.logger.warn(
        `SMTP send rejected: class=${rejection.class} code=${rejection.code ?? 'none'}`,
      );
      throw error;
    }
  }
}
