import { NOTIFY_FANOUT_QUEUE } from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job, type WorkerOptions } from 'bullmq';
import {
  parseFanOutJob,
  type ProcessNotifyFanOut,
} from '../../application/process-notify-fanout.usecase';

export type WorkerFactory = (
  queueName: string,
  processor: (job: Job) => Promise<void>,
  options: WorkerOptions,
) => { close(): Promise<void> };

export const bullmqWorkerFactory: WorkerFactory = (
  queueName,
  processor,
  options,
) => new Worker(queueName, processor, options);

export class NotifyFanOutConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(NotifyFanOutConsumer.name);
  private worker: { close(): Promise<void> } | null = null;

  constructor(
    private readonly useCase: ProcessNotifyFanOut,
    private readonly redisUrl: string,
    private readonly createWorker: WorkerFactory = bullmqWorkerFactory,
  ) {}

  onModuleInit(): void {
    this.worker = this.createWorker(
      NOTIFY_FANOUT_QUEUE,
      async (job) => {
        const parsed = parseFanOutJob(job.data);
        await this.useCase.execute(parsed);
      },
      {
        connection: { url: this.redisUrl },
        concurrency: 4,
      },
    );
    this.logger.log(`Listening on ${NOTIFY_FANOUT_QUEUE}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
