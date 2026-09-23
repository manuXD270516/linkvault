import {
  GROUP_DIGEST_QUEUE,
  groupDigestJobPayloadSchema,
} from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job, type WorkerOptions } from 'bullmq';
import type { ProcessGroupWeeklyDigest } from '../../application/process-group-weekly-digest.usecase';

export type DigestWorkerFactory = (
  queueName: string,
  processor: (job: Job) => Promise<void>,
  options: WorkerOptions,
) => { close(): Promise<void> };

export const bullmqDigestWorkerFactory: DigestWorkerFactory = (
  queueName,
  processor,
  options,
) => new Worker(queueName, processor, options);

export class GroupDigestConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(GroupDigestConsumer.name);
  private worker: { close(): Promise<void> } | null = null;

  constructor(
    private readonly useCase: ProcessGroupWeeklyDigest,
    private readonly redisUrl: string,
    private readonly createWorker: DigestWorkerFactory = bullmqDigestWorkerFactory,
  ) {}

  onModuleInit(): void {
    this.worker = this.createWorker(
      GROUP_DIGEST_QUEUE,
      async (job) => {
        const payload = groupDigestJobPayloadSchema.parse(job.data);
        const result = await this.useCase.execute(payload.weekKey);
        if (result.emailsSent > 0) {
          this.logger.log(
            `Digest ${payload.weekKey}: sent=${result.emailsSent} groups=${result.groupsScanned}`,
          );
        }
      },
      {
        connection: { url: this.redisUrl },
        concurrency: 1,
      },
    );
    this.logger.log(`Listening on ${GROUP_DIGEST_QUEUE}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
