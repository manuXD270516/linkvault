import type {
  MailLocale,
  MailTemplateId,
  MailTemplateVariables,
} from './mailer.port';

// Plantillas V0 solo texto plano ES/EN (ADR-034 D6). Sin HTML. No loguear el cuerpo ni el token.

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
}

const TEMPLATES: Record<
  MailTemplateId,
  Record<MailLocale, { subject: string; body: (v: MailTemplateVariables) => string }>
> = {
  'email-verification': {
    es: {
      subject: 'Verifica tu email en LinkVault',
      body: (v) =>
        [
          `Hola ${v.displayName},`,
          '',
          'Confirma tu dirección de correo en LinkVault abriendo este enlace:',
          v.actionUrl,
          '',
          `El enlace caduca en ${v.expiresInHuman}.`,
          '',
          'Si no creaste esta cuenta, puedes ignorar este mensaje.',
          '',
          '— LinkVault',
        ].join('\n'),
    },
    en: {
      subject: 'Verify your email on LinkVault',
      body: (v) =>
        [
          `Hi ${v.displayName},`,
          '',
          'Confirm your email address on LinkVault by opening this link:',
          v.actionUrl,
          '',
          `This link expires in ${v.expiresInHuman}.`,
          '',
          'If you did not create this account, you can ignore this message.',
          '',
          '— LinkVault',
        ].join('\n'),
    },
  },
  'password-reset': {
    es: {
      subject: 'Restablece tu contraseña de LinkVault',
      body: (v) =>
        [
          `Hola ${v.displayName},`,
          '',
          'Para restablecer tu contraseña de LinkVault, abre este enlace:',
          v.actionUrl,
          '',
          `El enlace caduca en ${v.expiresInHuman}.`,
          '',
          'Si no pediste este cambio, puedes ignorar este mensaje.',
          '',
          '— LinkVault',
        ].join('\n'),
    },
    en: {
      subject: 'Reset your LinkVault password',
      body: (v) =>
        [
          `Hi ${v.displayName},`,
          '',
          'To reset your LinkVault password, open this link:',
          v.actionUrl,
          '',
          `This link expires in ${v.expiresInHuman}.`,
          '',
          'If you did not request this change, you can ignore this message.',
          '',
          '— LinkVault',
        ].join('\n'),
    },
  },
};

/** Asunto + cuerpo plano de una plantilla tipada. */
export function renderMail(
  templateId: MailTemplateId,
  locale: MailLocale,
  variables: MailTemplateVariables,
): RenderedMail {
  const entry = TEMPLATES[templateId][locale];
  return { subject: entry.subject, text: entry.body(variables) };
}

/** Caducidad humana corta para el cuerpo del correo (locale del destinatario). */
export function expiresInHuman(
  locale: MailLocale,
  ttlSeconds: number,
): string {
  const hours = Math.round(ttlSeconds / 3600);
  if (hours >= 1 && ttlSeconds % 3600 === 0) {
    if (locale === 'en') {
      return hours === 1 ? '1 hour' : `${hours} hours`;
    }
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));
  if (locale === 'en') {
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}
