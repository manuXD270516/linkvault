import {
  APPLICATION_STALE_AFTER_DAYS,
  APPLICATION_STALE_EVENT_TYPE,
  applicationStaleEvent,
  applicationStaleJobId,
  CLOSED_STATUSES,
  isClosedStatus,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  APPLICATION_STALE_CLAIMS,
  NOTIFY_CLOCK,
  NOTIFY_FANOUT_QUEUE_PUBLISHER,
  type ApplicationStaleClaims,
  type Clock,
  type NotifyFanoutQueuePublisher,
} from './ports/notify.ports';

/** Lease del claim antes de confirmar el Queue.add (ADR-035 D5). */
export const STALE_CLAIM_LEASE_MS = 60_000;

const BATCH = 50;

/**
 * Detector periódico de postulaciones estancadas (ADR-024 / ADR-035 D5).
 * Sin outbox: claim con lease + Queue.add a notify-fanout.
 */
@Injectable()
export class DetectStaleApplications {
  private readonly logger = new Logger(DetectStaleApplications.name);

  constructor(
    @Inject(APPLICATION_STALE_CLAIMS)
    private readonly claims: ApplicationStaleClaims,
    @Inject(NOTIFY_FANOUT_QUEUE_PUBLISHER)
    private readonly queue: NotifyFanoutQueuePublisher,
    @Inject(NOTIFY_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const threshold = new Date(
      now.getTime() - APPLICATION_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    const eligible = await this.claims.listEligible(threshold, BATCH);
    let enqueued = 0;
    for (const row of eligible) {
      if (isClosedStatus(row.status as never)) {
        continue;
      }
      if (
        (CLOSED_STATUSES as readonly string[]).includes(row.status)
      ) {
        continue;
      }
      const claimed = await this.claims.claim(
        row.applicationId,
        row.statusChangedAt,
        now,
        STALE_CLAIM_LEASE_MS,
      );
      if (!claimed) {
        continue;
      }
      const payload = {
        applicationId: row.applicationId,
        userId: row.userId,
        linkId: row.linkId,
        status: row.status as never,
        lastChangedAt: row.statusChangedAt.toISOString(),
        staleAfterDays: APPLICATION_STALE_AFTER_DAYS,
      };
      const event = applicationStaleEvent(payload);
      try {
        await this.queue.add({
          name: APPLICATION_STALE_EVENT_TYPE,
          data: event.payload as unknown as Record<string, unknown>,
          jobId: applicationStaleJobId(payload),
        });
        await this.claims.confirm(row.applicationId, row.statusChangedAt);
        enqueued += 1;
      } catch (error: unknown) {
        await this.claims.release(row.applicationId, row.statusChangedAt);
        this.logger.warn(
          `stale enqueue failed: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
    }
    return enqueued;
  }
}
