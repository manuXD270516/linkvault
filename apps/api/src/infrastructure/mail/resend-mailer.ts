import { Logger } from '@nestjs/common';
import { renderMail } from './mail-templates';
import type { Mailer, MailMessage } from './mailer.port';

export interface ResendMailerOptions {
  readonly apiKey: string;
  readonly from: string;
  /** Solo tests: sustituye `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Adaptador Resend por HTTP (`MAIL_PROVIDER=resend`). Nunca loguea la API key ni el cuerpo del correo.
 */
export class ResendMailer implements Mailer {
  private readonly logger = new Logger(ResendMailer.name);
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResendMailerOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: MailMessage): Promise<void> {
    const rendered = renderMail(
      message.templateId,
      message.locale,
      message.variables,
    );
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: rendered.subject,
        text: rendered.text,
      }),
    });
    if (!response.ok) {
      // Sin cuerpo ni clave: solo el estado HTTP para diagnóstico.
      this.logger.warn(`Resend API rejected send with status ${response.status}`);
      throw new Error(`Resend API error: ${response.status}`);
    }
  }
}
