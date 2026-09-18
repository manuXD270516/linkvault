import { ENRICH_LINK_QUEUE, linkCreatedPayloadSchema } from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { DelayedError, Worker, type Job, type WorkerOptions } from 'bullmq';
import { z } from 'zod';
import type { EnrichLinkUseCase } from '../../application/enrich-link.usecase';

// Consumidor de la cola `enrich-link` (D1 y D6 de link-enrichment). El `Worker` se construye aquí a mano en vez de con
// `@Processor` de `@nestjs/bullmq` por una razón concreta: `concurrency` y `lockDuration` salen de la configuración, y
// las opciones de ese decorador se fijan al escribir el código, no al arrancar el proceso.
//
// `lockDuration` **por encima** de `ENRICH_DEADLINE_MS` (C18): un job puede tardar legítimamente todo el plazo del
// link, y con un bloqueo más corto BullMQ lo daría por `stalled` y lo reentregaría. Ese duplicado es justo lo que este
// change existe para evitar, y encima descargaría la misma página dos veces.

/** Holgura sobre el plazo del link: lo que tarda en escribir, subir el snapshot y avisar, más margen. */
export const LOCK_DURATION_MARGIN_MS = 15_000;

export function lockDurationFor(deadlineMs: number): number {
  return deadlineMs + LOCK_DURATION_MARGIN_MS;
}

/**
 * Datos del job. El relay publica `LinkCreated.v1` (`linkId` y `previewVersion`); `deferrals` lo añade este consumidor
 * al aplazar un job por encontrar su host ocupado, así que falta en el primer intento.
 */
export const enrichLinkJobDataSchema = linkCreatedPayloadSchema.extend({
  deferrals: z.number().int().min(0).default(0),
});
export type EnrichLinkJobData = z.input<typeof enrichLinkJobDataSchema>;

/** Lo que el consumidor necesita de un job; `Job` de BullMQ lo cumple. */
export interface EnrichLinkJobHandle {
  readonly id?: string;
  readonly data: unknown;
  updateData(data: EnrichLinkJobData): Promise<void>;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

/** Lo que el consumidor necesita de un `Worker`; se inyecta para que ningún test abra Redis. */
export interface WorkerHandle {
  close(): Promise<void>;
  on(
    event: 'failed',
    listener: (job: Job | undefined, error: Error) => void,
  ): unknown;
}

export type WorkerFactory = (
  queueName: string,
  processor: (job: Job, token?: string) => Promise<void>,
  options: WorkerOptions,
) => WorkerHandle;

export interface EnrichLinkConsumerOptions {
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly deadlineMs: number;
}

/** Fábrica real: un `Worker` de BullMQ con su propia conexión. */
export const bullmqWorkerFactory: WorkerFactory = (
  queueName,
  processor,
  options,
) => new Worker(queueName, processor, options);

export class EnrichLinkConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EnrichLinkConsumer.name);
  private worker: WorkerHandle | null = null;

  constructor(
    private readonly useCase: EnrichLinkUseCase,
    private readonly options: EnrichLinkConsumerOptions,
    private readonly createWorker: WorkerFactory = bullmqWorkerFactory,
    private readonly now: () => number = Date.now,
  ) {}

  onModuleInit(): void {
    this.worker = this.createWorker(
      ENRICH_LINK_QUEUE,
      (job, token) => this.handle(job, token),
      {
        connection: {
          url: this.options.redisUrl,
          maxRetriesPerRequest: null,
        },
        concurrency: this.options.concurrency,
        lockDuration: lockDurationFor(this.options.deadlineMs),
      } as WorkerOptions,
    );
    // Sin oyente de `failed`, un job que agota sus reintentos no dejaría rastro; el que decide qué hacer con el link
    // es `onJobFailed`.
    this.worker.on('failed', (job, error) => {
      void this.onJobFailed(job, error);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // `close()` espera a que terminen los jobs en curso: apagar a mitad de una descarga dejaría el host tomado.
    await this.worker?.close();
    this.worker = null;
  }

  /** Procesa un job. Lo que devuelve el caso de uso decide si el job termina o vuelve a la cola con espera. */
  async handle(job: EnrichLinkJobHandle, token?: string): Promise<void> {
    const parsed = enrichLinkJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      // Un job con datos que no son el contrato no se reintenta: reintentarlo daría el mismo error para siempre.
      this.logger.warn(`enrich-link job ${job.id ?? '?'} has unusable data`);
      return;
    }

    const result = await this.useCase.execute(parsed.data);
    if (result.kind !== 'deferred') return;

    // El host estaba ocupado: el job espera su turno sin ocupar un hueco del `Worker` mientras está `delayed`.
    await job.updateData({ ...parsed.data, deferrals: result.deferrals });
    await job.moveToDelayed(this.now() + result.waitMs, token);
    // BullMQ exige este error para no dar el job por terminado; no es un fallo y no cuenta como intento.
    throw new DelayedError();
  }

  /**
   * Un job que agota sus reintentos deja el link en `failed` con su propio motivo, nunca en `pending` para siempre
   * (D5). Mientras le queden intentos no se toca el link: el siguiente intento puede salir bien.
   */
  async onJobFailed(job: Job | undefined, error: Error): Promise<void> {
    if (job === undefined || error instanceof DelayedError) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;

    const parsed = enrichLinkJobDataSchema.safeParse(job.data);
    if (!parsed.success) return;

    await this.useCase.markRetriesExhausted(parsed.data);
  }
}
