import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  SEARCH_INDEX_QUEUE,
  type SearchIndexJobPublisher,
  toSearchDeleteJob,
  toSearchUpsertJob,
} from '../../application/ports/search-index-job-publisher.port';

/**
 * Publicador BullMQ de SearchUpsert/Delete desde el worker (FEATURE_SEARCH).
 * No escribe outbox: el agregado ya está en Mongo; el consumer recalcula ACL.
 */
export class BullmqSearchIndexJobPublisher
  implements SearchIndexJobPublisher, OnApplicationShutdown
{
  private readonly logger = new Logger(BullmqSearchIndexJobPublisher.name);
  private readonly queue: Queue;
  private readonly enabled: boolean;

  constructor(redisUrl: string, enabled: boolean) {
    this.enabled = enabled;
    this.queue = new Queue(SEARCH_INDEX_QUEUE, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800 },
      },
    });
  }

  async upsert(input: Parameters<SearchIndexJobPublisher['upsert']>[0]): Promise<void> {
    if (!this.enabled) return;
    const { payload, jobId } = toSearchUpsertJob(input);
    await this.queue.add(SEARCH_INDEX_QUEUE, payload, { jobId });
    this.logger.debug(
      `enqueued SearchUpsert ${payload.docType}:${payload.aggregateId}`,
    );
  }

  async delete(input: Parameters<SearchIndexJobPublisher['delete']>[0]): Promise<void> {
    if (!this.enabled) return;
    const { payload, jobId } = toSearchDeleteJob(input);
    await this.queue.add(SEARCH_INDEX_QUEUE, payload, { jobId });
    this.logger.debug(
      `enqueued SearchDelete ${payload.docType}:${payload.aggregateId}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/** No-op para tests / FEATURE_SEARCH=false. */
export class NoopSearchIndexJobPublisher implements SearchIndexJobPublisher {
  async upsert(): Promise<void> {
    /* no-op */
  }

  async delete(): Promise<void> {
    /* no-op */
  }
}
