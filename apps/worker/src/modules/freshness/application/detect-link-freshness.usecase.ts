import {
  ENRICH_TRIGGERED_BY_FRESHNESS,
  freshnessBucket,
  freshnessRecheckJobId,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  isExpiresAtPast,
  isKnownNonScrapeablePlatform,
} from '../domain/freshness-policy';
import {
  CLOSE_JOB_LINK,
  ENRICH_LINK_QUEUE_PUBLISHER,
  EXPIRE_APPLICATIONS_FOR_CLOSED_LINK,
  FRESHNESS_CLOCK,
  FRESHNESS_LINK_CLAIMS,
  FRESHNESS_LINK_STORE,
  type CloseJobLink,
  type EnrichLinkQueuePublisher,
  type ExpireApplicationsForClosedLink,
  type FreshnessClock,
  type FreshnessLinkClaims,
  type FreshnessLinkRow,
  type FreshnessLinkStore,
} from './ports/freshness.ports';

/** Lease del claim de frescura antes de confirmar el efecto (ADR-037). */
export const FRESHNESS_CLAIM_LEASE_MS = 60_000;

export interface DetectLinkFreshnessOptions {
  readonly enabled: boolean;
  readonly intervalDays: number;
  readonly batchLimit: number;
}

/**
 * Detector de frescura (ADR-037 D1/D3/D3b): prioriza cascada, luego abiertas (cadencia OR expiresAt).
 */
@Injectable()
export class DetectLinkFreshness {
  private readonly logger = new Logger(DetectLinkFreshness.name);

  constructor(
    private readonly options: DetectLinkFreshnessOptions,
    @Inject(FRESHNESS_LINK_STORE) private readonly links: FreshnessLinkStore,
    @Inject(FRESHNESS_LINK_CLAIMS) private readonly claims: FreshnessLinkClaims,
    @Inject(ENRICH_LINK_QUEUE_PUBLISHER)
    private readonly enrichQueue: EnrichLinkQueuePublisher,
    @Inject(CLOSE_JOB_LINK) private readonly close: CloseJobLink,
    @Inject(EXPIRE_APPLICATIONS_FOR_CLOSED_LINK)
    private readonly expire: ExpireApplicationsForClosedLink,
    @Inject(FRESHNESS_CLOCK) private readonly clock: FreshnessClock,
  ) {}

  async execute(): Promise<{
    readonly cascade: number;
    readonly calendar: number;
    readonly enqueued: number;
    readonly deferred: number;
  }> {
    if (!this.options.enabled) {
      return { cascade: 0, calendar: 0, enqueued: 0, deferred: 0 };
    }

    const now = this.clock.now();
    const limit = this.options.batchLimit;
    let remaining = limit;
    let cascade = 0;
    let calendar = 0;
    let enqueued = 0;
    let deferred = 0;

    const cascadeRows = await this.links.listCascadePending({
      limit: remaining,
    });
    for (const row of cascadeRows) {
      if (remaining <= 0) break;
      const ok = await this.processClaimed(row, async () => {
        await this.expire.execute(row.linkId);
        cascade += 1;
      });
      if (ok) remaining -= 1;
    }

    if (remaining <= 0) {
      return { cascade, calendar, enqueued, deferred };
    }

    const openRows = await this.links.listOpenEligible({
      now,
      intervalDays: this.options.intervalDays,
      limit: remaining,
    });
    for (const row of openRows) {
      if (remaining <= 0) break;
      const ok = await this.processClaimed(row, async () => {
        const result = await this.handleOpen(row, now);
        if (result === 'calendar') calendar += 1;
        else if (result === 'enqueued') enqueued += 1;
        else deferred += 1;
      });
      if (ok) remaining -= 1;
    }

    return { cascade, calendar, enqueued, deferred };
  }

  private async processClaimed(
    row: FreshnessLinkRow,
    work: () => Promise<void>,
  ): Promise<boolean> {
    const now = this.clock.now();
    const claimed = await this.claims.claim(
      row.linkId,
      now,
      FRESHNESS_CLAIM_LEASE_MS,
    );
    if (!claimed) return false;
    try {
      await work();
      await this.claims.confirm(row.linkId);
      return true;
    } catch (error: unknown) {
      await this.claims.release(row.linkId);
      this.logger.warn(
        `freshness work failed for ${row.linkId}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      return false;
    }
  }

  private async handleOpen(
    row: FreshnessLinkRow,
    now: Date,
  ): Promise<'calendar' | 'enqueued' | 'deferred'> {
    const expiresAt = row.preview.expiresAt;
    if (
      typeof expiresAt === 'string' &&
      isExpiresAtPast(expiresAt, now)
    ) {
      await this.close.execute({ linkId: row.linkId, reason: 'calendar' });
      return 'calendar';
    }

    if (isKnownNonScrapeablePlatform(row.platform)) {
      await this.links.touchFreshnessCheck(row.linkId, now);
      return 'deferred';
    }

    const bucket = freshnessBucket(now, this.options.intervalDays);
    await this.enrichQueue.add({
      jobId: freshnessRecheckJobId(row.linkId, bucket),
      data: {
        linkId: row.linkId,
        previewVersion: row.previewVersion,
        triggeredBy: ENRICH_TRIGGERED_BY_FRESHNESS,
      },
    });
    return 'enqueued';
  }
}
