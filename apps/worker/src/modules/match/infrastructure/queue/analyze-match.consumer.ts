import {
  ANALYZE_MATCH_QUEUE,
  matchRequestedPayloadSchema,
  type MatchRequestedPayload,
} from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Job, WorkerOptions } from 'bullmq';
import type { AnalyzeMatchUseCase } from '../../application/analyze-match.usecase';
import {
  bullmqWorkerFactory,
  type WorkerFactory,
  type WorkerHandle,
} from './worker-factory';

// Consumidor de `analyze-match` (tarea 13.13, ADR-030 §6). Cola propia, sin reintento a ciegas (`attempts: 1` en
// el relay). `lockDuration = timeout + 15 s` para que un análisis lento no se marque stalled y se reentregue.

/** Holgura sobre el plazo del worker: mismo margen que extract-cv / enrich-link. */
export const MATCH_LOCK_DURATION_MARGIN_MS = 15_000;

export function matchLockDurationFor(timeoutMs: number): number {
  return timeoutMs + MATCH_LOCK_DURATION_MARGIN_MS;
}

export interface AnalyzeMatchConsumerOptions {
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly timeoutMs: number;
}

export interface MatchJobHandle {
  readonly id?: string;
  readonly data: unknown;
}

export class AnalyzeMatchConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AnalyzeMatchConsumer.name);
  private worker: WorkerHandle | null = null;

  constructor(
    private readonly useCase: AnalyzeMatchUseCase,
    private readonly options: AnalyzeMatchConsumerOptions,
    private readonly createWorker: WorkerFactory = bullmqWorkerFactory,
  ) {}

  onModuleInit(): void {
    this.worker = this.createWorker(
      ANALYZE_MATCH_QUEUE,
      (job) => this.handle(job),
      {
        connection: {
          url: this.options.redisUrl,
          maxRetriesPerRequest: null,
        },
        concurrency: this.options.concurrency,
        lockDuration: matchLockDurationFor(this.options.timeoutMs),
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

  async handle(job: MatchJobHandle): Promise<void> {
    const payload = this.payloadOf(job);
    if (payload === null) {
      return;
    }
    const result = await this.useCase.execute(payload);
    this.logger.debug(`analysis ${payload.analysisId}: ${result.kind}`);
  }

  /**
   * Con `attempts: 1`, cualquier fallo del procesador deja el análisis en `failed` con `internal_error`.
   * No se reintenta a ciegas: eso multiplicaría los envíos del CV (ADR-030 §6).
   */
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

  private payloadOf(job: MatchJobHandle): MatchRequestedPayload | null {
    const parsed = matchRequestedPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.warn(`analyze-match job ${job.id ?? '?'} has unusable data`);
      return null;
    }
    return parsed.data;
  }
}
