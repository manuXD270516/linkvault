import { Worker, type Job, type WorkerOptions } from 'bullmq';

// Fábrica del `Worker` de BullMQ, compartida por los dos consumidores de `cv`. Se inyecta para que **ningún test abra
// Redis**: un `Worker` conecta nada más crearse.

/** Lo que un consumidor necesita de un `Worker`. */
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

/** Fábrica real: un `Worker` de BullMQ con su propia conexión. */
export const bullmqWorkerFactory: WorkerFactory = (
  queueName,
  processor,
  options,
) => new Worker(queueName, processor, options);
