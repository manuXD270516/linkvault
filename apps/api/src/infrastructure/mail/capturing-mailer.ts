import type { Mailer, MailMessage } from './mailer.port';

/**
 * Adaptador de tests/CI (`MAIL_PROVIDER=capture`): guarda los mensajes en memoria sin red (ADR-034 D2).
 * Consultable por el harness; nunca envía nada.
 */
export class CapturingMailer implements Mailer {
  readonly messages: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.messages.push({
      to: message.to,
      templateId: message.templateId,
      locale: message.locale,
      variables: { ...message.variables },
    });
    return Promise.resolve();
  }

  clear(): void {
    this.messages.length = 0;
  }

  /** Último mensaje hacia `to` (normalización trivial: minúsculas). */
  lastTo(to: string): MailMessage | undefined {
    const normalized = to.trim().toLowerCase();
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message !== undefined && message.to.toLowerCase() === normalized) {
        return message;
      }
    }
    return undefined;
  }
}
