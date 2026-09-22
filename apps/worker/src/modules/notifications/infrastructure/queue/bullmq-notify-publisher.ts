import { NOTIFY_FANOUT_QUEUE } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { NotifyFanoutQueuePublisher } from '../../application/ports/notify.ports';

export const NOTIFY_FANOUT_QUEUE_TOKEN = Symbol('NOTIFY_FANOUT_QUEUE_TOKEN');

@Injectable()
export class BullmqNotifyFanoutPublisher implements NotifyFanoutQueuePublisher {
  constructor(
    @Inject(NOTIFY_FANOUT_QUEUE_TOKEN) private readonly queue: Queue,
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

export function createNotifyFanoutQueue(redisUrl: string): Queue {
  return new Queue(NOTIFY_FANOUT_QUEUE, { connection: { url: redisUrl } });
}
