import {
  LINK_ENRICHED_CHANNEL,
  type LinkEnrichedEvent,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { EnrichmentNotifier } from '../../application/ports/enrichment-notifier.port';

// Adaptador `ENRICHMENT_NOTIFIER` sobre el canal de Redis que `api` reparte por SSE (D9 de link-enrichment). Publica el
// evento entero, tal y como lo construye `linkEnrichedEvent()`, serializado con `JSON.stringify`: al otro lado,
// `RedisEnrichmentNotices` lo valida contra `linkEnrichedEventSchema` antes de tocar nada, y ese esquema es `strict`,
// así que aquí no se añade ni un campo de más.
//
// **Publicar no es parte del trabajo.** Cuando esto se llama, el preview ya está escrito en Mongo y la escritura
// condicionada ya se ganó: si Redis no responde, lo único que se pierde es que una pantalla abierta se entere sola, y
// al recargar el listado trae la verdad. Por eso un fallo aquí no se propaga —volvería a descargar la página de un
// sitio ajeno para escribir exactamente lo mismo— y se registra una vez por racha, como hace la conexión del módulo:
// un Redis caído produce un fallo por cada link enriquecido, y de eso no hace falta un renglón por link.
//
// El aviso no lleva URL, ni preview, ni texto de la página: solo identificador, estado y versión.

/**
 * Lo que el adaptador necesita de Redis, declarado aquí en vez de con `Pick<Redis, …>`: un `Redis` de ioredis lo
 * cumple, y un doble de test también, sin arrastrar las sobrecargas variádicas del cliente real. Se reutiliza el
 * cliente del enriquecimiento porque solo publica: el que no se puede compartir es un cliente en modo suscripción,
 * que deja de aceptar comandos.
 */
export interface EnrichmentPublisherClient {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Lo que este adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface EnrichmentNotifierLogger {
  warn(message: string): void;
}

export class RedisEnrichmentNotifier implements EnrichmentNotifier {
  private reported = false;

  constructor(
    private readonly client: EnrichmentPublisherClient,
    private readonly logger: EnrichmentNotifierLogger = new Logger(
      'EnrichmentNotifier',
    ),
  ) {}

  async publish(event: LinkEnrichedEvent): Promise<void> {
    try {
      await this.client.publish(LINK_ENRICHED_CHANNEL, JSON.stringify(event));
      // Vuelve a haber canal: la próxima racha de fallos sí merece su renglón.
      this.reported = false;
    } catch (error: unknown) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    if (this.reported) return;
    this.reported = true;
    this.logger.warn(
      `could not announce an enriched link: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
