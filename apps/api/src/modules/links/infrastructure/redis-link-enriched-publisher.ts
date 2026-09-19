import {
  LINK_ENRICHED_CHANNEL,
  linkEnrichedEvent,
  type LinkEnrichedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { LinkEnrichedPublisher } from '../application/ports/link-enriched-publisher.port';

// Adaptador LINK_ENRICHED_PUBLISHER sobre el canal de Redis que ya usa el worker (D6 de paste-job-description). Publica el
// evento entero, construido con `linkEnrichedEvent()`, como `RedisEnrichmentNotifier` del worker: al otro lado,
// `RedisEnrichmentNotices` lo valida contra su esquema estricto antes de repartirlo.
//
// Usa el cliente de aplicación de `api` (`REDIS_APP_CLIENT`): solo publica, y el que no se puede compartir es el de
// suscripción. Ese cliente no encola comandos sin conexión y los corta a los 200 ms, así que con Redis caído publicar
// falla enseguida en vez de quedarse esperando. El fallo se registra una vez por racha y nunca se propaga.
//
// El aviso no lleva URL, ni preview, ni texto pegado: solo identificador, estado y versión.

/** Lo que el adaptador necesita de Redis; un `Redis` de ioredis lo cumple, y un doble de test también. */
export interface LinkEnrichedPublisherClient {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Lo que el adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface LinkEnrichedPublisherLogger {
  warn(message: string): void;
}

export class RedisLinkEnrichedPublisher implements LinkEnrichedPublisher {
  private reported = false;

  constructor(
    private readonly client: LinkEnrichedPublisherClient,
    private readonly logger: LinkEnrichedPublisherLogger = new Logger(
      RedisLinkEnrichedPublisher.name,
    ),
  ) {}

  async publish(payload: LinkEnrichedPayload): Promise<void> {
    try {
      await this.client.publish(
        LINK_ENRICHED_CHANNEL,
        JSON.stringify(linkEnrichedEvent(payload)),
      );
      // Vuelve a haber canal: la próxima racha de fallos sí merece su renglón.
      this.reported = false;
    } catch (error: unknown) {
      this.report(error);
    }
  }

  /** Un aviso por racha, con el nombre del error y sin su mensaje ni el del aviso. */
  private report(error: unknown): void {
    if (this.reported) return;
    this.reported = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Could not announce a changed link (${name}); open screens will not update on their own`,
    );
  }
}
