// Puerto Mailer (ADR-034 D1): envío de correo transaccional sin acoplar auth a Resend/SMTP.
// Solo tipos y token; los adaptadores viven junto a este archivo.
// Plantillas de producto (notifications / ADR-035): group-new-link, application-status, application-stale.

export const MAILER = Symbol('MAILER');

export type MailLocale = 'es' | 'en';

export type MailTemplateId =
  | 'email-verification'
  | 'password-reset'
  | 'group-new-link'
  | 'application-status'
  | 'application-stale';

export interface MailTemplateVariables {
  readonly displayName: string;
  readonly actionUrl: string;
  /** Solo plantillas de auth (verify/reset). */
  readonly expiresInHuman?: string;
  readonly groupName?: string;
  readonly linkTitle?: string;
  readonly statusLabel?: string;
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
