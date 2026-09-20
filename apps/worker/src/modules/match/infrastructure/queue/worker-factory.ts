import { Worker, type Job, type WorkerOptions } from 'bullmq';

// Fábrica del `Worker` de BullMQ del módulo `match`. Se inyecta para que ningún test abra Redis.

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

export const bullmqWorkerFactory: WorkerFactory = (
  queueName,
  processor,
  options,
) => new Worker(queueName, processor, options);
