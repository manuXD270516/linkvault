import {
  BUILD_ROADMAP_QUEUE,
  roadmapRequestedPayloadSchema,
  type RoadmapRequestedPayload,
} from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Job, WorkerOptions } from 'bullmq';
import type { BuildRoadmapUseCase } from '../../application/build-roadmap.usecase';
import {
  bullmqWorkerFactory,
  type WorkerFactory,
  type WorkerHandle,
} from './worker-factory';

export const ROADMAP_LOCK_DURATION_MARGIN_MS = 15_000;

export function roadmapLockDurationFor(timeoutMs: number): number {
  return timeoutMs + ROADMAP_LOCK_DURATION_MARGIN_MS;
}

export interface BuildRoadmapConsumerOptions {
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly timeoutMs: number;
}

export interface RoadmapJobHandle {
  readonly id?: string;
  readonly data: unknown;
}

export class BuildRoadmapConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(BuildRoadmapConsumer.name);
  private worker: WorkerHandle | null = null;

  constructor(
    private readonly useCase: BuildRoadmapUseCase,
    private readonly options: BuildRoadmapConsumerOptions,
    private readonly createWorker: WorkerFactory = bullmqWorkerFactory,
  ) {}

  onModuleInit(): void {
    this.worker = this.createWorker(
      BUILD_ROADMAP_QUEUE,
      (job) => this.handle(job),
      {
        connection: {
          url: this.options.redisUrl,
          maxRetriesPerRequest: null,
        },
        concurrency: this.options.concurrency,
        lockDuration: roadmapLockDurationFor(this.options.timeoutMs),
      } as WorkerOptions,
    );
    this.worker.on('failed', (job) => {
      void this.onJobFailed(job);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  async handle(job: RoadmapJobHandle): Promise<void> {
    const payload = this.payloadOf(job);
    if (payload === null) {
      return;
    }
    const result = await this.useCase.execute(payload);
    this.logger.debug(`roadmap ${payload.analysisId}: ${result.kind}`);
  }

  async onJobFailed(job: Job | undefined): Promise<void> {
    if (job === undefined) {
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      return;
    }
    const payload = this.payloadOf(job);
    if (payload === null) {
      return;
    }
    await this.useCase.markRetriesExhausted(payload);
  }

  private payloadOf(job: RoadmapJobHandle): RoadmapRequestedPayload | null {
    const parsed = roadmapRequestedPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.warn(`build-roadmap job ${job.id ?? '?'} has unusable data`);
      return null;
    }
    return parsed.data;
  }
}
