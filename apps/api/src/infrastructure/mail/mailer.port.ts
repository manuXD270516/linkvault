// Puerto Mailer (ADR-034 D1): envío de correo transaccional sin acoplar auth a Resend/SMTP.
// Solo tipos y token; los adaptadores viven junto a este archivo.

export const MAILER = Symbol('MAILER');

export type MailLocale = 'es' | 'en';

export type MailTemplateId = 'email-verification' | 'password-reset';

export interface MailTemplateVariables {
  readonly displayName: string;
  readonly actionUrl: string;
  readonly expiresInHuman: string;
}

export interface MailMessage {
  readonly to: string;
  readonly templateId: MailTemplateId;
  readonly locale: MailLocale;
  readonly variables: MailTemplateVariables;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
