import {
  GROUP_DIGEST_JOB_NAME,
  GROUP_DIGEST_QUEUE,
  groupDigestJobId,
  groupDigestJobPayloadSchema,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { GroupDigestQueuePublisher } from '../../application/ports/notify.ports';

export const GROUP_DIGEST_QUEUE_TOKEN = Symbol('GROUP_DIGEST_QUEUE_TOKEN');

@Injectable()
export class BullmqGroupDigestPublisher implements GroupDigestQueuePublisher {
  constructor(
    @Inject(GROUP_DIGEST_QUEUE_TOKEN) private readonly queue: Queue,
  ) {}

  async add(job: {
    readonly name: string;
    readonly data: { readonly weekKey: string };
    readonly jobId: string;
  }): Promise<void> {
    const data = groupDigestJobPayloadSchema.parse(job.data);
    await this.queue.add(job.name, data, {
      jobId: job.jobId,
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}

export function createGroupDigestQueue(redisUrl: string): Queue {
  return new Queue(GROUP_DIGEST_QUEUE, { connection: { url: redisUrl } });
}

/** Encola el job raíz single-flight para una weekKey. */
export async function enqueueGroupDigestWeek(
  publisher: GroupDigestQueuePublisher,
  weekKey: string,
): Promise<void> {
  await publisher.add({
    name: GROUP_DIGEST_JOB_NAME,
    data: { weekKey },
    jobId: groupDigestJobId(weekKey),
  });
}
