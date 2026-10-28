import { Inject, Injectable, Logger } from '@nestjs/common';
import { classifySmtpRejection, smtpTransportOptions } from '@linkvault/shared';
import type {
  NotifyMailer,
  NotifyMailMessage,
} from '../../application/ports/notify.ports';

// Plantillas producto texto plano (espejo de api mail-templates; ADR-035). Sin stageLabel/notas.

function renderProduct(message: NotifyMailMessage): {
  subject: string;
  text: string;
} {
  const v = message.variables;
  if (message.templateId === 'group-new-link') {
    if (message.locale === 'en') {
      return {
        subject: 'New link in your group',
        text: [
          `Hi ${v.displayName},`,
          '',
          v.groupName
            ? `A new link was added in the group “${v.groupName}”.`
            : 'A new link was added in one of your groups.',
          v.linkTitle ? `Listing: ${v.linkTitle}` : '',
          '',
          'Open it here:',
          v.actionUrl,
          '',
          '— LinkVault',
        ]
          .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
          .join('\n'),
      };
    }
    return {
      subject: 'Nuevo link en tu grupo',
      text: [
        `Hola ${v.displayName},`,
        '',
        v.groupName
          ? `Se añadió un link nuevo en el grupo «${v.groupName}».`
          : 'Se añadió un link nuevo en uno de tus grupos.',
        v.linkTitle ? `Oferta: ${v.linkTitle}` : '',
        '',
        'Ábrelo aquí:',
        v.actionUrl,
        '',
        '— LinkVault',
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n'),
    };
  }
  if (message.templateId === 'application-status') {
    if (message.locale === 'en') {
      return {
        subject: 'Application update in your group',
        text: [
          `Hi ${v.displayName},`,
          '',
          v.statusLabel
            ? `There is an application update: status “${v.statusLabel}”.`
            : 'There is an application update in your group.',
          v.linkTitle ? `Listing: ${v.linkTitle}` : '',
          '',
          'View on LinkVault:',
          v.actionUrl,
          '',
          '— LinkVault',
        ]
          .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
          .join('\n'),
      };
    }
    return {
      subject: 'Actualización de postulación en el grupo',
      text: [
        `Hola ${v.displayName},`,
        '',
        v.statusLabel
          ? `Hay una actualización de postulación: estado «${v.statusLabel}».`
          : 'Hay una actualización de postulación en el grupo.',
        v.linkTitle ? `Oferta: ${v.linkTitle}` : '',
        '',
        'Ver en LinkVault:',
        v.actionUrl,
        '',
        '— LinkVault',
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n'),
    };
  }
  // application-stale
  if (message.templateId === 'application-stale') {
    if (message.locale === 'en') {
      return {
        subject: 'Your application has had no updates',
        text: [
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
        ].join('\n'),
      };
    }
    return {
      subject: 'Tu postulación lleva tiempo sin cambios',
      text: [
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
      ].join('\n'),
    };
  }

  // group-weekly-digest
  const titles = v.linkTitles ?? [];
  const more = v.moreCount ?? 0;
  const groupLabel = v.groupName ?? '';
  if (message.locale === 'en') {
    const titleLines = titles.map((t) => `• ${t}`);
    if (more > 0) {
      titleLines.push(`…and ${more} more`);
    }
    return {
      subject: groupLabel
        ? `Weekly digest · ${groupLabel}`
        : 'Weekly group digest',
      text: [
        `Hi ${v.displayName},`,
        '',
        groupLabel
          ? `Here’s what was shared in “${groupLabel}” last week:`
          : 'Here’s what was shared in your group last week:',
        '',
        ...titleLines,
        '',
        'Open the group:',
        v.actionUrl,
        '',
        'Notification preferences:',
        v.preferencesUrl ?? '',
        '',
        '— LinkVault',
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n'),
    };
  }
  const titleLinesEs = titles.map((t) => `• ${t}`);
  if (more > 0) {
    titleLinesEs.push(`…y ${more} más`);
  }
  return {
    subject: groupLabel
      ? `Resumen semanal · ${groupLabel}`
      : 'Resumen semanal del grupo',
    text: [
      `Hola ${v.displayName},`,
      '',
      groupLabel
        ? `Esto se compartió en «${groupLabel}» la semana pasada:`
        : 'Esto se compartió en tu grupo la semana pasada:',
      '',
      ...titleLinesEs,
      '',
      'Ver grupo:',
      v.actionUrl,
      '',
      'Preferencias de notificación:',
      v.preferencesUrl ?? '',
      '',
      '— LinkVault',
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n'),
  };
}

/** Captura en memoria (tests / MAIL_PROVIDER=capture). */
@Injectable()
export class CapturingNotifyMailer implements NotifyMailer {
  readonly sent: NotifyMailMessage[] = [];

  send(message: NotifyMailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

export const NOTIFY_MAIL_FROM = Symbol('NOTIFY_MAIL_FROM');
export const NOTIFY_MAIL_TRANSPORT = Symbol('NOTIFY_MAIL_TRANSPORT');

export type NotifyMailTransport = 'capture' | 'smtp' | 'resend';

/** Servidor SMTP de las notificaciones: Mailpit sin credenciales, o uno con usuario y contraseña (design D6). */
export interface NotifySmtpSettings {
  readonly host: string;
  readonly port: number;
  /** TLS implícito (`MAIL_SMTP_SECURE=true`); por defecto, en claro con STARTTLS exigido si hay credenciales. */
  readonly secure?: boolean;
  readonly user?: string;
  readonly password?: string;
  /** CA adicional en la que confiar (la del servidor de pruebas). */
  readonly trustedCa?: string;
}

@Injectable()
export class SmtpOrResendNotifyMailer implements NotifyMailer {
  constructor(
    @Inject(NOTIFY_MAIL_FROM) private readonly from: string,
    @Inject(NOTIFY_MAIL_TRANSPORT)
    private readonly transport: NotifyMailTransport,
    private readonly smtp?: NotifySmtpSettings,
    private readonly resendKey?: string,
    private readonly logger: Pick<Logger, 'warn'> = new Logger(
      SmtpOrResendNotifyMailer.name,
    ),
  ) {}

  async send(message: NotifyMailMessage): Promise<void> {
    const rendered = renderProduct(message);
    if (this.transport === 'capture') {
      return;
    }
    if (this.transport === 'smtp') {
      const nodemailer = await import('nodemailer');
      // Las mismas opciones que el adaptador de `api` (`smtpTransportOptions`, design D6 de `staging-host`): con
      // credenciales, cifrado antes de enviarlas y certificado verificado.
      const transporter = nodemailer.createTransport(
        smtpTransportOptions({
          host: this.smtp?.host ?? 'localhost',
          port: this.smtp?.port ?? 1025,
          secure: this.smtp?.secure ?? false,
          user: this.smtp?.user,
          password: this.smtp?.password,
          trustedCa: this.smtp?.trustedCa,
        }),
      );
      try {
        await transporter.sendMail({
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
      return;
    }
    const key = this.resendKey ?? '';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
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
      throw new Error(`Resend HTTP ${response.status}`);
    }
  }
}
