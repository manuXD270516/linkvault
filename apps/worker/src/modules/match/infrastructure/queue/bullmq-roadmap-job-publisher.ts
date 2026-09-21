import {
  BUILD_ROADMAP_QUEUE,
  roadmapRequestedJobId,
  type RoadmapRequestedPayload,
} from '@linkvault/shared';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { RoadmapJobPublisher } from '../../application/ports/roadmap-job-publisher.port';

/**
 * Publicador BullMQ del worker (opción A): sin outbox en el proceso worker.
 * `jobId` determinista + claim en Mongo evitan doble LLM.
 */
export class BullmqRoadmapJobPublisher
  implements RoadmapJobPublisher, OnApplicationShutdown
{
  private readonly logger = new Logger(BullmqRoadmapJobPublisher.name);
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.queue = new Queue(BUILD_ROADMAP_QUEUE, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800 },
      },
    });
  }

  async enqueue(payload: RoadmapRequestedPayload): Promise<void> {
    const jobId = roadmapRequestedJobId(payload);
    await this.queue.add(BUILD_ROADMAP_QUEUE, payload, { jobId });
    this.logger.debug(
      `enqueued roadmap build analysis=${payload.analysisId} jobId=${jobId}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
