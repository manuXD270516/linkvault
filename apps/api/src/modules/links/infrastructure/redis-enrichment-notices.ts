import {
  LINK_ENRICHED_CHANNEL,
  linkEnrichedEventSchema,
  type LinkEnrichedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { EnrichmentNotices } from '../application/ports/enrichment-notices.port';

// Adaptador ENRICHMENT_NOTICES sobre un canal de Redis (D9). Necesita **su propia conexión**: un cliente en modo
// suscripción no acepta comandos, así que no se puede compartir con el que cuenta intentos.
//
// Lo que llega por el canal se valida contra el contrato antes de tocar nada: por ahí puede aparecer cualquier cosa, y
// un mensaje que no cumple se descarta con un aviso sin cuerpo. Nunca se registra el contenido del mensaje.

/**
 * Lo que el adaptador necesita de un cliente Redis suscriptor. Se declara aquí, y no como un `Pick` de `Redis`, para
 * dejar dicho exactamente qué se usa y para que un doble de test no tenga que fingir las 450 propiedades de ioredis.
 */
export interface RedisSubscriber {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  off(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
}

/** Lo que el adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface EnrichmentNoticesLogger {
  warn(message: string): void;
}

export class RedisEnrichmentNotices implements EnrichmentNotices {
  constructor(
    private readonly client: RedisSubscriber,
    private readonly logger: EnrichmentNoticesLogger = new Logger(
      RedisEnrichmentNotices.name,
    ),
  ) {}

  async subscribe(
    handler: (payload: LinkEnrichedPayload) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const onMessage = (channel: string, message: string): void => {
      if (channel !== LINK_ENRICHED_CHANNEL) {
        return;
      }
      void this.deliver(message, handler);
    };
    this.client.on('message', onMessage);
    await this.client.subscribe(LINK_ENRICHED_CHANNEL);
    return async () => {
      this.client.off('message', onMessage);
      await this.client.unsubscribe(LINK_ENRICHED_CHANNEL);
    };
  }

  private async deliver(
    message: string,
    handler: (payload: LinkEnrichedPayload) => Promise<void>,
  ): Promise<void> {
    const parsed = this.parse(message);
    if (parsed === null) {
      return;
    }
    try {
      await handler(parsed);
    } catch (error) {
      // Un fallo repartiendo no puede tirar la suscripción: el estado verdadero sigue en la base de datos.
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Could not deliver a link enriched notice (${name})`);
    }
  }

  /** `null` si el mensaje no es un aviso válido. No se registra su contenido. */
  private parse(message: string): LinkEnrichedPayload | null {
    let body: unknown;
    try {
      body = JSON.parse(message);
    } catch {
      this.logger.warn('Discarded a notice that is not valid JSON');
      return null;
    }
    const event = linkEnrichedEventSchema.safeParse(body);
    if (!event.success) {
      this.logger.warn('Discarded a notice that does not match its contract');
      return null;
    }
    return event.data.payload;
  }
}
