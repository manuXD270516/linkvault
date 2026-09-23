import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GROUP_DIGEST_QUEUE_PUBLISHER,
  NOTIFY_CLOCK,
  type Clock,
  type GroupDigestQueuePublisher,
} from '../../application/ports/notify.ports';
import { previousClosedIsoWeek } from '../../domain/iso-week';
import { enqueueGroupDigestWeek } from './bullmq-group-digest-publisher';

/**
 * Cuerpo del tick semanal. El `@Cron(GROUP_DIGEST_CRON)` lo registra
 * `NotificationsModule` con una clase host dinámica (UTC).
 */
@Injectable()
export class GroupDigestScheduler {
  private readonly logger = new Logger(GroupDigestScheduler.name);

  constructor(
    @Inject(GROUP_DIGEST_QUEUE_PUBLISHER)
    private readonly queue: GroupDigestQueuePublisher,
    @Inject(NOTIFY_CLOCK) private readonly clock: Clock,
  ) {}

  async tick(): Promise<void> {
    try {
      const { weekKey } = previousClosedIsoWeek(this.clock.now());
      await enqueueGroupDigestWeek(this.queue, weekKey);
      this.logger.log(`Enqueued digest job for ${weekKey}`);
    } catch (error: unknown) {
      this.logger.warn(
        `Digest enqueue failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }
}
