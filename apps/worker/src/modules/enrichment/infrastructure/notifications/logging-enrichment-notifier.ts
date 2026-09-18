import type { LinkEnrichedEvent } from '@linkvault/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { EnrichmentNotifier } from '../../application/ports/enrichment-notifier.port';

// Implementación provisional de `ENRICHMENT_NOTIFIER`: deja constancia del aviso y no sale del proceso. El publicador
// del canal de Redis que `api` reparte por SSE llega con la tarea 6.7 y sustituye a esta sin tocar el caso de uso,
// que es para lo que el puerto existe.
//
// El aviso no lleva la URL del usuario ni el preview: solo identificador, estado y versión (D9).

@Injectable()
export class LoggingEnrichmentNotifier implements EnrichmentNotifier {
  private readonly logger = new Logger('EnrichmentNotifier');

  publish(event: LinkEnrichedEvent): Promise<void> {
    const { linkId, previewStatus, previewVersion } = event.payload;
    this.logger.debug(
      `link ${linkId} enriched: ${previewStatus} (v${previewVersion})`,
    );
    return Promise.resolve();
  }
}
