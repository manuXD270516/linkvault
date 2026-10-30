import {
  EXTRACT_CV_QUEUE,
  cvUploadedPayloadSchema,
  type CvUploadedPayload,
} from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { UnrecoverableError, type Job, type WorkerOptions } from 'bullmq';
import type { ExtractCvUseCase } from '../../application/extract-cv.usecase';
import {
  bullmqWorkerFactory,
  type WorkerFactory,
  type WorkerHandle,
} from './worker-factory';

// Consumidor de la cola `extract-cv` (D9 de cv-upload-extract). El `Worker` se construye a mano y no con `@Processor`
// por la misma razón que en `enrich-link`: `concurrency` y `lockDuration` salen de la configuración, y las opciones de
// ese decorador se fijan al escribir el código, no al arrancar el proceso.
//
// **Cola propia**, no la del enriquecimiento: así un CV lento no ocupa un hueco de los links, que es lo que el parseo
// de un PDF —trabajo de CPU en el hilo principal— haría si compartieran cola.
//
// `lockDuration` **por encima** del plazo de la extracción: un CV puede tardar legítimamente todo el plazo, y con un
// bloqueo más corto BullMQ lo daría por `stalled` y lo reentregaría. Ese duplicado abriría dos veces el mismo archivo.

/**
 * Reentregas por `stalled` que BullMQ tolera (D8 de cv-extract-isolation): **explícito** en vez del valor por defecto
 * implícito. Con 1, una muerte del proceso a mitad de lectura reabre el archivo como mucho una vez más: la segunda
 * detección no lo reabre, lo falla con `deferredFailure` + `UnrecoverableError` (BullMQ 6.3.6).
 */
export const CV_MAX_STALLED_COUNT = 1;

/** Holgura sobre el plazo: lo que tarda en escribir el resultado, más margen. El mismo que `enrich-link`. */
export const CV_LOCK_DURATION_MARGIN_MS = 15_000;

export function cvLockDurationFor(timeoutMs: number): number {
  return timeoutMs + CV_LOCK_DURATION_MARGIN_MS;
}

export interface ExtractCvConsumerOptions {
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly timeoutMs: number;
}

/** Lo que el consumidor necesita de un job; `Job` de BullMQ lo cumple. */
export interface CvJobHandle {
  readonly id?: string;
  readonly data: unknown;
}

export class ExtractCvConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ExtractCvConsumer.name);
  private worker: WorkerHandle | null = null;

  constructor(
    private readonly useCase: ExtractCvUseCase,
    private readonly options: ExtractCvConsumerOptions,
    private readonly createWorker: WorkerFactory = bullmqWorkerFactory,
  ) {}

  onModuleInit(): void {
    if (this.options.concurrency > 1) {
      // H12 / D5 de cv-extract-isolation: cada lectura es un proceso hijo con su heap y su techo. Solo la cuenta, sin
      // datos de ningún CV; el RUNBOOK explica `memory_ceiling`.
      this.logger.warn(
        `extract-cv concurrency is ${this.options.concurrency}: CV read memory can reach ${this.options.concurrency} x (256 MB heap + 512 MiB resident ceiling + ~40 MB startup)`,
      );
    }
    this.worker = this.createWorker(
      EXTRACT_CV_QUEUE,
      (job) => this.handle(job),
      {
        connection: {
          url: this.options.redisUrl,
          maxRetriesPerRequest: null,
        },
        concurrency: this.options.concurrency,
        lockDuration: cvLockDurationFor(this.options.timeoutMs),
        maxStalledCount: CV_MAX_STALLED_COUNT,
      } as WorkerOptions,
    );
    // Sin oyente de `failed`, un job que agota sus reintentos dejaría el CV en `pending` para siempre.
    this.worker.on('failed', (job, error) => {
      void this.onJobFailed(job, error);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // `close()` espera a que terminen los jobs en curso: apagar a mitad de una lectura dejaría el CV en `pending`.
    await this.worker?.close();
    this.worker = null;
  }

  /** Procesa un job. Ninguno de los desenlaces del caso de uso es un error: todos terminan el job bien. */
  async handle(job: CvJobHandle): Promise<void> {
    const payload = this.payloadOf(job);
    if (payload === null) {
      return;
    }
    const result = await this.useCase.execute(payload);
    this.logger.debug(`cv ${payload.cvId}: extraction ${result.kind}`);
  }

  /**
   * Un job **sin reintento pendiente** deja el CV en `failed` con `internal_error`, nunca en `pending` para siempre
   * (D8). Sin reintento pendiente es: haber agotado los intentos, **o** haber fallado con un `UnrecoverableError` (lo que
   * BullMQ 6.3.6 hace con un job que supera `maxStalledCount`: lo falla con `deferredFailure` sin gastar intentos), **o**
   * tener `finishedOn` puesto (el job está en el conjunto `failed`, no en `delayed`). No se mira el texto del error.
   * Mientras le queden intentos no se toca el CV: el siguiente puede salir bien.
   */
  async onJobFailed(job: Job | undefined, error?: Error): Promise<void> {
    if (job === undefined) {
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    const noRetryPending =
      job.attemptsMade >= attempts ||
      error instanceof UnrecoverableError ||
      typeof job.finishedOn === 'number';
    if (!noRetryPending) {
      return;
    }
    const payload = this.payloadOf(job);
    if (payload === null) {
      return;
    }
    await this.useCase.markRetriesExhausted(payload);
  }

  private payloadOf(job: CvJobHandle): CvUploadedPayload | null {
    const parsed = cvUploadedPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      // Un job con datos que no son el contrato no se reintenta: daría el mismo error para siempre. El aviso lleva el
      // identificador del job y nada del CV.
      this.logger.warn(`extract-cv job ${job.id ?? '?'} has unusable data`);
      return null;
    }
    return parsed.data;
  }
}
