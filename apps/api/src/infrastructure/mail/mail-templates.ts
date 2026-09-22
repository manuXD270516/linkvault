import type {
  MailLocale,
  MailTemplateId,
  MailTemplateVariables,
} from './mailer.port';

// Plantillas V0 solo texto plano ES/EN (ADR-034 D6; producto ADR-035). Sin HTML. No loguear el cuerpo ni el token.
// Avisos de grupo/estado: sin stageLabel ni notas (ADR-024 / ADR-035).

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
}

function joinPlain(lines: readonly string[]): string {
  return lines.join('\n');
}

const TEMPLATES: Record<
  MailTemplateId,
  Record<MailLocale, { subject: string; body: (v: MailTemplateVariables) => string }>
> = {
  'email-verification': {
    es: {
      subject: 'Verifica tu email en LinkVault',
      body: (v) =>
        joinPlain([
          `Hola ${v.displayName},`,
          '',
          'Confirma tu dirección de correo en LinkVault abriendo este enlace:',
          v.actionUrl,
          '',
          `El enlace caduca en ${v.expiresInHuman ?? ''}.`,
          '',
          'Si no creaste esta cuenta, puedes ignorar este mensaje.',
          '',
          '— LinkVault',
        ]),
    },
    en: {
      subject: 'Verify your email on LinkVault',
      body: (v) =>
        joinPlain([
          `Hi ${v.displayName},`,
          '',
          'Confirm your email address on LinkVault by opening this link:',
          v.actionUrl,
          '',
          `This link expires in ${v.expiresInHuman ?? ''}.`,
          '',
          'If you did not create this account, you can ignore this message.',
          '',
          '— LinkVault',
        ]),
    },
  },
  'password-reset': {
    es: {
      subject: 'Restablece tu contraseña de LinkVault',
      body: (v) =>
        joinPlain([
          `Hola ${v.displayName},`,
          '',
          'Para restablecer tu contraseña de LinkVault, abre este enlace:',
          v.actionUrl,
          '',
          `El enlace caduca en ${v.expiresInHuman ?? ''}.`,
          '',
          'Si no pediste este cambio, puedes ignorar este mensaje.',
          '',
          '— LinkVault',
        ]),
    },
    en: {
      subject: 'Reset your LinkVault password',
      body: (v) =>
        joinPlain([
          `Hi ${v.displayName},`,
          '',
          'To reset your LinkVault password, open this link:',
          v.actionUrl,
          '',
          `This link expires in ${v.expiresInHuman ?? ''}.`,
          '',
          'If you did not request this change, you can ignore this message.',
          '',
          '— LinkVault',
        ]),
    },
  },
  'group-new-link': {
    es: {
      subject: 'Nuevo link en tu grupo',
      body: (v) => {
        const lines: string[] = [
          `Hola ${v.displayName},`,
          '',
          v.groupName
            ? `Se añadió un link nuevo en el grupo «${v.groupName}».`
            : 'Se añadió un link nuevo en uno de tus grupos.',
        ];
        if (v.linkTitle) {
          lines.push(`Oferta: ${v.linkTitle}`);
        }
        lines.push('', 'Ábrelo aquí:', v.actionUrl, '', '— LinkVault');
        return joinPlain(lines);
      },
    },
    en: {
      subject: 'New link in your group',
      body: (v) => {
        const lines: string[] = [
          `Hi ${v.displayName},`,
          '',
          v.groupName
            ? `A new link was added in the group “${v.groupName}”.`
            : 'A new link was added in one of your groups.',
        ];
        if (v.linkTitle) {
          lines.push(`Listing: ${v.linkTitle}`);
        }
        lines.push('', 'Open it here:', v.actionUrl, '', '— LinkVault');
        return joinPlain(lines);
      },
    },
  },
  'application-status': {
    es: {
      subject: 'Actualización de postulación en el grupo',
      body: (v) => {
        const lines: string[] = [
          `Hola ${v.displayName},`,
          '',
          v.statusLabel
            ? `Hay una actualización de postulación: estado «${v.statusLabel}».`
            : 'Hay una actualización de postulación en el grupo.',
        ];
        if (v.linkTitle) {
          lines.push(`Oferta: ${v.linkTitle}`);
        }
        if (v.groupName) {
          lines.push(`Grupo: ${v.groupName}`);
        }
        lines.push('', 'Ver en LinkVault:', v.actionUrl, '', '— LinkVault');
        return joinPlain(lines);
      },
    },
    en: {
      subject: 'Application update in your group',
      body: (v) => {
        const lines: string[] = [
          `Hi ${v.displayName},`,
          '',
          v.statusLabel
            ? `There is an application update: status “${v.statusLabel}”.`
            : 'There is an application update in your group.',
        ];
        if (v.linkTitle) {
          lines.push(`Listing: ${v.linkTitle}`);
        }
        if (v.groupName) {
          lines.push(`Group: ${v.groupName}`);
        }
        lines.push('', 'View on LinkVault:', v.actionUrl, '', '— LinkVault');
        return joinPlain(lines);
      },
    },
  },
  'application-stale': {
    es: {
      subject: 'Tu postulación lleva tiempo sin cambios',
      body: (v) =>
        joinPlain([
          `Hola ${v.displayName},`,
          '',
          v.linkTitle
            ? `Tu postulación a «${v.linkTitle}» lleva días sin actualizarse.`
            : 'Una de tus postulaciones lleva días sin actualizarse.',
          '',
          'Revisa el estado o actualízalo aquí:',
          v.actionUrl,
          '',
          '— LinkVault',
        ]),
    },
    en: {
      subject: 'Your application has had no updates',
      body: (v) =>
        joinPlain([
          `Hi ${v.displayName},`,
          '',
          v.linkTitle
            ? `Your application for “${v.linkTitle}” has had no updates for several days.`
            : 'One of your applications has had no updates for several days.',
          '',
          'Review or update it here:',
          v.actionUrl,
          '',
          '— LinkVault',
        ]),
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
