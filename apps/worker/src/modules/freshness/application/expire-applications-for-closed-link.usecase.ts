import {
  applicationStatusNotifyEvent,
  applicationStatusNotifyJobId,
  APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
} from '@linkvault/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SEARCH_INDEX_JOB_PUBLISHER,
  type SearchIndexJobPublisher,
} from '../../search/application/ports/search-index-job-publisher.port';
import {
  CLOSED_LINK_APPLICATIONS,
  FRESHNESS_CLOCK,
  FRESHNESS_NOTIFY_QUEUE,
  STATUS_GROUP_NOTIFY_CLAIMS,
  type ClosedLinkApplications,
  type ExpireApplicationsForClosedLink,
  type FreshnessClock,
  type FreshnessNotifyQueuePublisher,
  type StatusGroupNotifyClaims,
} from './ports/freshness.ports';

/** Lease del claim ASN antes de confirmar Queue.add (mismo espíritu que stale / ADR-035). */
export const ASN_CLAIM_LEASE_MS = 60_000;

/**
 * Puerto de auto-expire al cerrar vacante (ADR-037 D5): abiertas → `expired` idempotente;
 * visibility=group → claim→Queue.add ASN→confirm; Search upsert si FEATURE_SEARCH.
 */
@Injectable()
export class ExpireApplicationsForClosedLinkUseCase
  implements ExpireApplicationsForClosedLink
{
  private readonly logger = new Logger(
    ExpireApplicationsForClosedLinkUseCase.name,
  );

  constructor(
    @Inject(CLOSED_LINK_APPLICATIONS)
    private readonly applications: ClosedLinkApplications,
    @Inject(STATUS_GROUP_NOTIFY_CLAIMS)
    private readonly claims: StatusGroupNotifyClaims,
    @Inject(FRESHNESS_NOTIFY_QUEUE)
    private readonly notifyQueue: FreshnessNotifyQueuePublisher,
    @Inject(FRESHNESS_CLOCK) private readonly clock: FreshnessClock,
    @Optional()
    @Inject(SEARCH_INDEX_JOB_PUBLISHER)
    private readonly search: SearchIndexJobPublisher | null = null,
  ) {}

  async execute(
    linkId: string,
  ): Promise<{ readonly expired: number; readonly notified: number }> {
    const rows = await this.applications.listForExpireCascade(linkId);
    let expired = 0;
    let notified = 0;
    const now = this.clock.now();

    for (const row of rows) {
      let current = row;
      if (isOpenStatus(row.status)) {
        const next = await this.applications.expireIfOpen(
          row.applicationId,
          now,
        );
        if (next === null) {
          continue;
        }
        expired += 1;
        current = next;
        await this.upsertApplicationSearch(current);
      }

      if (current.visibility !== 'group' || current.status !== 'expired') {
        continue;
      }

      const claimed = await this.claims.claim(
        current.applicationId,
        current.statusChangedAt,
        now,
        ASN_CLAIM_LEASE_MS,
      );
      if (!claimed) {
        continue;
      }

      const payload = {
        applicationId: current.applicationId,
        linkId: current.linkId,
        actorUserId: current.userId,
        status: 'expired' as const,
        statusChangedAt: current.statusChangedAt.toISOString(),
      };
      const event = applicationStatusNotifyEvent(payload);
      try {
        await this.notifyQueue.add({
          name: APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
          data: event.payload as unknown as Record<string, unknown>,
          jobId: applicationStatusNotifyJobId(payload),
        });
        await this.claims.confirm(
          current.applicationId,
          current.statusChangedAt,
        );
        notified += 1;
      } catch (error: unknown) {
        await this.claims.release(
          current.applicationId,
          current.statusChangedAt,
        );
        this.logger.warn(
          `ASN enqueue failed for ${current.applicationId}: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
    }

    return { expired, notified };
  }

  private async upsertApplicationSearch(row: {
    readonly applicationId: string;
    readonly status: string;
    readonly version: number;
  }): Promise<void> {
    if (this.search === null) return;
    await this.search.upsert({
      docType: 'application',
      aggregateId: row.applicationId,
      reason: 'application_upsert',
      fingerprint: `app:${row.applicationId}:${row.status}:${row.version}`,
    });
  }
}

function isOpenStatus(status: string): boolean {
  return (
    status === 'saved' ||
    status === 'interested' ||
    status === 'applied' ||
    status === 'in_process' ||
    status === 'offer'
  );
}
