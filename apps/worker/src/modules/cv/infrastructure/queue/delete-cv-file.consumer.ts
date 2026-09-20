import {
  DELETE_CV_FILE_QUEUE,
  cvDeletedPayloadSchema,
} from '@linkvault/shared';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { WorkerOptions } from 'bullmq';
import type { DeleteCvFileUseCase } from '../../application/delete-cv-file.usecase';
import type { CvJobHandle } from './extract-cv.consumer';
import {
  bullmqWorkerFactory,
  type WorkerFactory,
  type WorkerHandle,
} from './worker-factory';

// Consumidor de la cola `delete-cv-file` (D8 de cv-upload-extract, ADR-028 §8). Borra el objeto del almacén a partir
// del evento `CvDeleted.v1`, que la API escribió en la misma transacción que borró el documento.
//
// No lleva `onJobFailed`, y es deliberado: aquí no hay ningún agregado que se quede sin explicación. Si se agotan los
// reintentos, lo que queda es un **objeto huérfano** —invisible para la persona y para la API— que el barrido en dos
// pasos del RUNBOOK recoge. Marcar algo en la base sería inventar un estado que nadie mira.
//
// La concurrencia es 1: borrar un objeto no cuesta CPU y no hay prisa que justifique más conexiones.
export const DELETE_CV_FILE_CONCURRENCY = 1;

export interface DeleteCvFileConsumerOptions {
  readonly redisUrl: string;
}

export class DeleteCvFileConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(DeleteCvFileConsumer.name);
  private worker: WorkerHandle | null = null;

  constructor(
    private readonly useCase: DeleteCvFileUseCase,
    private readonly options: DeleteCvFileConsumerOptions,
    private readonly createWorker: WorkerFactory = bullmqWorkerFactory,
  ) {}

  onModuleInit(): void {
    this.worker = this.createWorker(
      DELETE_CV_FILE_QUEUE,
      (job) => this.handle(job),
      {
        connection: {
          url: this.options.redisUrl,
          maxRetriesPerRequest: null,
        },
        concurrency: DELETE_CV_FILE_CONCURRENCY,
      } as WorkerOptions,
    );
    // Sin oyente de `error`/`failed`, BullMQ emitiría sin oyentes y Node tumbaría el proceso.
    this.worker.on('failed', (job) => {
      this.logger.warn(`delete-cv-file job ${job?.id ?? '?'} failed`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  /** Un fallo del almacén **lanza**: la cola lo reintenta y el objeto se borra cuando el almacén vuelva. */
  async handle(job: CvJobHandle): Promise<void> {
    const parsed = cvDeletedPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.warn(`delete-cv-file job ${job.id ?? '?'} has unusable data`);
      return;
    }
    await this.useCase.execute(parsed.data);
  }
}
