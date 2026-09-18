import {
  isRetryableEnrichmentReason,
  linkCreatedEvent,
  enrichmentFailureReasonSchema,
  type EnrichmentFailureReason,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkRepository,
} from './ports/job-link-repository.port';
import { OUTBOX, type Outbox } from './ports/outbox.port';

/**
 * Reencolado de links sin preview (spec links/enrichment, D10 de link-enrichment). Es un comando manual: **no** se
 * ejecuta al arrancar la aplicación, porque un despliegue no es una razón para volver a descargar páginas ajenas.
 *
 * Hace lo mismo que el alta de un link y que el reintento: en una transacción sube `previewVersion`, vuelve a
 * `pending`, limpia el motivo del fallo y escribe `LinkCreated.v1` en el outbox. No mira `outbox_events` ni toca
 * BullMQ, así que funciona con el publicador apagado: las peticiones esperan ahí y se publican cuando vuelve.
 *
 * **Sube la versión siempre**, también con `--status=pending`. Con la misma versión el `jobId` determinista no cambia y
 * `Queue.add` sobre un job retenido es un no-op silencioso, que es justo el atasco que este comando existe para
 * deshacer. Tampoco duplica trabajo: si el job viejo sigue vivo, el consumidor lo descarta por versión.
 */
@Injectable()
export class BackfillEnrichment {
  private readonly logger = new Logger(BackfillEnrichment.name);

  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(options: BackfillOptions): Promise<BackfillReport> {
    const reasons =
      options.status === 'failed' ? RETRYABLE_ENRICHMENT_REASONS : undefined;
    const candidates = await this.links.listByPreviewStatus(
      options.status,
      options.limit,
      reasons,
    );

    let requested = 0;
    for (const candidate of candidates) {
      const asked = await this.request(candidate.id);
      if (asked) {
        requested += 1;
      }
    }
    this.logger.log(
      `Backfill asked for ${requested} of ${candidates.length} ${options.status} links to be read again`,
    );
    return { found: candidates.length, requested };
  }

  /** `false` si el link dejó de existir entre la lectura y la escritura: no es un fallo del comando. */
  private async request(linkId: string): Promise<boolean> {
    const requested = await this.links.withRequestedEnrichment(
      linkId,
      this.clock.now(),
      async (link, session) => {
        await this.outbox.append(
          linkCreatedEvent({
            linkId: link.id,
            previewVersion: link.previewVersion,
          }),
          session,
        );
        return true;
      },
    );
    return requested === true;
  }
}

/** Estados que el comando sabe reencolar. Los demás no esperan ninguna lectura. */
export const BACKFILL_STATUSES = ['pending', 'failed'] as const;
export type BackfillStatus = (typeof BACKFILL_STATUSES)[number];

export interface BackfillOptions {
  readonly status: BackfillStatus;
  readonly limit: number;
}

export interface BackfillReport {
  /** Cuántos links cumplían la condición, hasta el límite pedido. */
  readonly found: number;
  /** De ellos, cuántos quedaron con su lectura pedida. */
  readonly requested: number;
}

/**
 * Motivos que el rescate de fallidos sí vuelve a intentar. Se derivan de la lista cerrada del contrato, no se copian:
 * un motivo nuevo entra aquí solo, y decidir si se reintenta se hace en un sitio (`isRetryableEnrichmentReason`).
 */
export const RETRYABLE_ENRICHMENT_REASONS: readonly EnrichmentFailureReason[] =
  enrichmentFailureReasonSchema.options.filter(isRetryableEnrichmentReason);
