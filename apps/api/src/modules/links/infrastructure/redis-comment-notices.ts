import {
  GROUP_LINK_COMMENTS_CHANNEL,
  groupLinkCommentsChangedEventSchema,
  type GroupLinkCommentsChangedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { CommentNotices } from '../application/ports/comment-notices.port';
import type { RedisSubscriber } from './redis-enrichment-notices';

// Adaptador COMMENT_NOTICES sobre el canal `events:group-link.comments` (D9 de group-comments). Comparte con
// `RedisEnrichmentNotices` el **mismo cliente suscriptor** del proceso (`REDIS_SUBSCRIBER_CLIENT`): una sola conexión en
// modo suscripción con los dos canales. Por eso filtra por canal —por el mismo cliente llegan los avisos de
// enriquecimiento— y no cierra la conexión al dejar de escuchar: solo suelta su canal.
//
// Lo que llega se valida contra el schema estricto antes de tocar nada. Un mensaje que no cumple se descarta con un aviso
// sin cuerpo: nunca se registra su contenido. El canal se vuelve a pedir en cada `ready`, porque ioredis solo reenvía al
// reconectar las suscripciones que llegó a aceptar.

/** Lo que el adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface CommentNoticesLogger {
  warn(message: string): void;
}

export class RedisCommentNotices implements CommentNotices {
  private warned = false;

  constructor(
    private readonly client: RedisSubscriber,
    private readonly logger: CommentNoticesLogger = new Logger(
      RedisCommentNotices.name,
    ),
  ) {}

  async subscribe(
    handler: (payload: GroupLinkCommentsChangedPayload) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const onMessage = (channel: string, message: string): void => {
      if (channel !== GROUP_LINK_COMMENTS_CHANNEL) {
        return;
      }
      void this.deliver(message, handler);
    };
    const onReady = (): void => {
      void this.listenOnChannel();
    };
    this.client.on('message', onMessage);
    this.client.on('ready', onReady);
    await this.open();
    return async () => {
      this.client.off('message', onMessage);
      this.client.off('ready', onReady);
      await this.client.unsubscribe(GROUP_LINK_COMMENTS_CHANNEL);
    };
  }

  /**
   * Abre la conexión si nadie lo hizo todavía, sin esperar a que conecte: el arranque de `api` no puede quedarse colgado
   * por Redis. Si ya está lista, pide el canal ahora; si no, lo pide en el `ready` que llegue.
   */
  private async open(): Promise<void> {
    if (this.client.status === 'ready') {
      await this.listenOnChannel();
      return;
    }
    if (this.client.status === 'wait') {
      this.client.connect().catch((error: unknown) => this.warnOnce(error));
    }
  }

  /** Pide el canal. No lanza: quien arranca solo necesita saber que no lo tiene. */
  private async listenOnChannel(): Promise<void> {
    try {
      await this.client.subscribe(GROUP_LINK_COMMENTS_CHANNEL);
      this.warned = false;
    } catch (error) {
      this.warnOnce(error);
    }
  }

  /** Un aviso por racha: sin esto, cada reintento de ioredis escribiría el suyo. */
  private warnOnce(error: unknown): void {
    if (this.warned) {
      return;
    }
    this.warned = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Could not subscribe to comment notices (${name}); open screens will not update on their own until Redis is back`,
    );
  }

  private async deliver(
    message: string,
    handler: (payload: GroupLinkCommentsChangedPayload) => Promise<void>,
  ): Promise<void> {
    const payload = this.parse(message);
    if (payload === null) {
      return;
    }
    try {
      await handler(payload);
    } catch (error) {
      // Un fallo repartiendo no puede tirar la suscripción: la verdad sigue en la base de datos.
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Could not deliver a comment notice (${name})`);
    }
  }

  /** `null` si el mensaje no es un aviso válido. No se registra su contenido. */
  private parse(message: string): GroupLinkCommentsChangedPayload | null {
    let body: unknown;
    try {
      body = JSON.parse(message);
    } catch {
      this.logger.warn('Discarded a comment notice that is not valid JSON');
      return null;
    }
    const event = groupLinkCommentsChangedEventSchema.safeParse(body);
    if (!event.success) {
      this.logger.warn(
        'Discarded a comment notice that does not match its contract',
      );
      return null;
    }
    return event.data.payload;
  }
}
