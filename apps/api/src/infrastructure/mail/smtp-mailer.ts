import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { renderMail } from './mail-templates';
import type { Mailer, MailMessage } from './mailer.port';

export interface SmtpMailerOptions {
  readonly host: string;
  readonly port: number;
  readonly from: string;
}

/**
 * Adaptador SMTP hacia Mailpit u otro relay (`MAIL_PROVIDER=smtp`). Solo texto plano; no loguea el cuerpo.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(options: SmtpMailerOptions) {
    this.from = options.from;
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: false,
      // Mailpit local no exige auth.
      tls: { rejectUnauthorized: false },
    });
  }

  async send(message: MailMessage): Promise<void> {
    const rendered = renderMail(
      message.templateId,
      message.locale,
      message.variables,
    );
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: rendered.subject,
      text: rendered.text,
    });
  }
}
