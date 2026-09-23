import { linkEnrichedEvent, type ClosedReason } from '@linkvault/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { EnrichmentNotifier } from '../../enrichment/application/ports/enrichment-notifier.port';
import {
  SEARCH_INDEX_JOB_PUBLISHER,
  type SearchIndexJobPublisher,
} from '../../search/application/ports/search-index-job-publisher.port';
import {
  EXPIRE_APPLICATIONS_FOR_CLOSED_LINK,
  FRESHNESS_CLOCK,
  FRESHNESS_ENRICHMENT_NOTIFIER,
  FRESHNESS_LINK_STORE,
  type CloseJobLink,
  type ExpireApplicationsForClosedLink,
  type FreshnessClock,
  type FreshnessLinkStore,
} from './ports/freshness.ports';

/**
 * Cierre idempotente de vacante (calendar o recheck) + SSE + expire + Search job_preview (ADR-037).
 */
@Injectable()
export class CloseJobLinkUseCase implements CloseJobLink {
  constructor(
    @Inject(FRESHNESS_LINK_STORE) private readonly links: FreshnessLinkStore,
    @Inject(FRESHNESS_CLOCK) private readonly clock: FreshnessClock,
    @Inject(FRESHNESS_ENRICHMENT_NOTIFIER)
    private readonly notifier: EnrichmentNotifier,
    @Inject(EXPIRE_APPLICATIONS_FOR_CLOSED_LINK)
    private readonly expire: ExpireApplicationsForClosedLink,
    @Optional()
    @Inject(SEARCH_INDEX_JOB_PUBLISHER)
    private readonly search: SearchIndexJobPublisher | null = null,
  ) {}

  async execute(input: {
    readonly linkId: string;
    readonly reason: ClosedReason;
  }): Promise<{ readonly closed: boolean; readonly alreadyClosed: boolean }> {
    const link = await this.links.findById(input.linkId);
    if (link === null) {
      return { closed: false, alreadyClosed: false };
    }

    const at = this.clock.now();
    const newlyClosed = await this.links.closeIfOpen(input.linkId, {
      closedAt: at,
      closedReason: input.reason,
      lastFreshnessCheckAt: at,
    });

    const closedAt = newlyClosed ? at : (link.closedAt ?? at);

    await this.notifier.publish(
      linkEnrichedEvent({
        linkId: link.linkId,
        previewStatus: link.previewStatus,
        previewVersion: link.previewVersion,
      }),
    );

    await this.upsertPreviewSearch(link.linkId, closedAt);
    await this.expire.execute(input.linkId);

    return {
      closed: newlyClosed,
      alreadyClosed: !newlyClosed && link.closedAt !== undefined,
    };
  }

  private async upsertPreviewSearch(
    linkId: string,
    closedAt: Date,
  ): Promise<void> {
    if (this.search === null) return;
    await this.search.upsert({
      docType: 'job_preview',
      aggregateId: linkId,
      reason: 'preview_updated',
      fingerprint: `job_preview:${linkId}:closed:${closedAt.toISOString()}`,
    });
  }
}
