import { ENRICH_LINK_QUEUE, NOTIFY_FANOUT_QUEUE } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type {
  EnrichLinkQueuePublisher,
  FreshnessNotifyQueuePublisher,
} from '../../application/ports/freshness.ports';

export const FRESHNESS_ENRICH_QUEUE_TOKEN = Symbol(
  'FRESHNESS_ENRICH_QUEUE_TOKEN',
);
export const FRESHNESS_NOTIFY_QUEUE_TOKEN = Symbol(
  'FRESHNESS_NOTIFY_QUEUE_TOKEN',
);

@Injectable()
export class BullmqEnrichLinkQueuePublisher implements EnrichLinkQueuePublisher {
  constructor(
    @Inject(FRESHNESS_ENRICH_QUEUE_TOKEN) private readonly queue: Queue,
  ) {}

  async add(job: {
    readonly data: {
      readonly linkId: string;
      readonly previewVersion: number;
      readonly triggeredBy: 'freshness';
    };
    readonly jobId: string;
  }): Promise<void> {
    await this.queue.add('freshness-recheck', job.data, {
      jobId: job.jobId,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}

@Injectable()
export class BullmqFreshnessNotifyPublisher
  implements FreshnessNotifyQueuePublisher
{
  constructor(
    @Inject(FRESHNESS_NOTIFY_QUEUE_TOKEN) private readonly queue: Queue,
  ) {}

  async add(job: {
    readonly name: string;
    readonly data: Record<string, unknown>;
    readonly jobId: string;
  }): Promise<void> {
    await this.queue.add(job.name, job.data, {
      jobId: job.jobId,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}

export function createEnrichLinkQueue(redisUrl: string): Queue {
  return new Queue(ENRICH_LINK_QUEUE, { connection: { url: redisUrl } });
}

export function createFreshnessNotifyQueue(redisUrl: string): Queue {
  return new Queue(NOTIFY_FANOUT_QUEUE, { connection: { url: redisUrl } });
}
