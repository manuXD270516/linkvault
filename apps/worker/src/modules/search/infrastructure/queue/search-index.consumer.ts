import { SEARCH_INDEX_QUEUE } from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { WorkerOptions } from 'bullmq';
import type { ProcessSearchIndex } from '../../application/process-search-index.usecase';
import {
  bullmqWorkerFactory,
  type WorkerFactory,
  type WorkerHandle,
} from '../../../cv/infrastructure/queue/worker-factory';

export const SEARCH_INDEX_CONCURRENCY = 2;

export interface SearchIndexConsumerOptions {
  readonly redisUrl: string;
}

interface JobHandle {
  readonly id?: string;
  readonly data: unknown;
}

export class SearchIndexConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SearchIndexConsumer.name);
  private worker: WorkerHandle | null = null;

  constructor(
    private readonly useCase: ProcessSearchIndex,
    private readonly options: SearchIndexConsumerOptions,
    private readonly createWorker: WorkerFactory = bullmqWorkerFactory,
  ) {}

  onModuleInit(): void {
    this.worker = this.createWorker(
      SEARCH_INDEX_QUEUE,
      (job) => this.handle(job),
      {
        connection: {
          url: this.options.redisUrl,
          maxRetriesPerRequest: null,
        },
        concurrency: SEARCH_INDEX_CONCURRENCY,
      } as WorkerOptions,
    );
    this.worker.on('failed', (job) => {
      this.logger.warn(`search-index job ${job?.id ?? '?'} failed`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  async handle(job: JobHandle): Promise<void> {
    await this.useCase.executePayload(job.data);
  }
}
