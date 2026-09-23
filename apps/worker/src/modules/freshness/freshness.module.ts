import {
  type DynamicModule,
  Module,
  type OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import { RedisEnrichmentNotifier } from '../enrichment/infrastructure/notifications/redis-enrichment-notifier';
import { createEnrichmentRedisClient } from '../enrichment/infrastructure/redis/enrichment-redis.client';
import { CloseJobLinkUseCase } from './application/close-job-link.usecase';
import { DetectLinkFreshness } from './application/detect-link-freshness.usecase';
import { ExpireApplicationsForClosedLinkUseCase } from './application/expire-applications-for-closed-link.usecase';
import {
  CLOSE_JOB_LINK,
  CLOSED_LINK_APPLICATIONS,
  ENRICH_LINK_QUEUE_PUBLISHER,
  EXPIRE_APPLICATIONS_FOR_CLOSED_LINK,
  FRESHNESS_CLOCK,
  FRESHNESS_ENRICHMENT_NOTIFIER,
  FRESHNESS_LINK_CLAIMS,
  FRESHNESS_LINK_STORE,
  FRESHNESS_NOTIFY_QUEUE,
  STATUS_GROUP_NOTIFY_CLAIMS,
  type EnrichLinkQueuePublisher,
} from './application/ports/freshness.ports';
import {
  MongoClosedLinkApplications,
  MongoFreshnessLinkClaims,
  MongoFreshnessLinkStore,
  MongoStatusGroupNotifyClaims,
} from './infrastructure/persistence/mongo-freshness.adapters';
import {
  BullmqEnrichLinkQueuePublisher,
  BullmqFreshnessNotifyPublisher,
  FRESHNESS_ENRICH_QUEUE_TOKEN,
  FRESHNESS_NOTIFY_QUEUE_TOKEN,
  createEnrichLinkQueue,
  createFreshnessNotifyQueue,
} from './infrastructure/queue/bullmq-freshness-publishers';
import { LinkFreshnessScheduler } from './infrastructure/queue/link-freshness.scheduler';


const FRESHNESS_REDIS = Symbol('FRESHNESS_REDIS');

class SystemClock {
  now(): Date {
    return new Date();
  }
}

class FreshnessQueueCloser implements OnModuleDestroy {
  constructor(
    private readonly enrich: Queue | null,
    private readonly notify: Queue | null,
    private readonly redis: Redis | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.enrich?.close();
    await this.notify?.close();
    this.redis?.disconnect();
  }
}

/**
 * Módulo de frescura de vacantes (ADR-037): detector, cierre, auto-expire + ASN.
 * En `NODE_ENV=test` no registra cron ni colas BullMQ.
 */
@Module({})
export class FreshnessModule {
  static register(
    config: WorkerConfig,
    searchModule: DynamicModule,
  ): DynamicModule {
    const live = config.NODE_ENV !== 'test';

    const shared: Provider[] = [
      { provide: FRESHNESS_CLOCK, useClass: SystemClock },
      { provide: FRESHNESS_LINK_STORE, useClass: MongoFreshnessLinkStore },
      { provide: FRESHNESS_LINK_CLAIMS, useClass: MongoFreshnessLinkClaims },
      {
        provide: CLOSED_LINK_APPLICATIONS,
        useClass: MongoClosedLinkApplications,
      },
      {
        provide: STATUS_GROUP_NOTIFY_CLAIMS,
        useClass: MongoStatusGroupNotifyClaims,
      },
      {
        provide: EXPIRE_APPLICATIONS_FOR_CLOSED_LINK,
        useClass: ExpireApplicationsForClosedLinkUseCase,
      },
      { provide: CLOSE_JOB_LINK, useClass: CloseJobLinkUseCase },
      {
        provide: DetectLinkFreshness,
        inject: [
          APP_CONFIG,
          FRESHNESS_LINK_STORE,
          FRESHNESS_LINK_CLAIMS,
          ENRICH_LINK_QUEUE_PUBLISHER,
          CLOSE_JOB_LINK,
          EXPIRE_APPLICATIONS_FOR_CLOSED_LINK,
          FRESHNESS_CLOCK,
        ],
        useFactory: (
          cfg: WorkerConfig,
          links: MongoFreshnessLinkStore,
          claims: MongoFreshnessLinkClaims,
          enrichQueue: EnrichLinkQueuePublisher,
          close: CloseJobLinkUseCase,
          expire: ExpireApplicationsForClosedLinkUseCase,
          clock: SystemClock,
        ) =>
          new DetectLinkFreshness(
            {
              enabled: cfg.FEATURE_LINK_FRESHNESS,
              intervalDays: cfg.LINK_FRESHNESS_INTERVAL_DAYS,
              batchLimit: cfg.LINK_FRESHNESS_BATCH_LIMIT,
            },
            links,
            claims,
            enrichQueue,
            close,
            expire,
            clock,
          ),
      },
    ];

    const queueProviders: Provider[] = live
      ? [
          {
            provide: FRESHNESS_REDIS,
            inject: [APP_CONFIG],
            useFactory: (cfg: WorkerConfig) =>
              createEnrichmentRedisClient(cfg.REDIS_URL),
          },
          {
            provide: FRESHNESS_ENRICHMENT_NOTIFIER,
            inject: [FRESHNESS_REDIS],
            useFactory: (redis: Redis) => new RedisEnrichmentNotifier(redis),
          },
          {
            provide: FRESHNESS_ENRICH_QUEUE_TOKEN,
            useFactory: () => createEnrichLinkQueue(config.REDIS_URL),
          },
          {
            provide: FRESHNESS_NOTIFY_QUEUE_TOKEN,
            useFactory: () => createFreshnessNotifyQueue(config.REDIS_URL),
          },
          {
            provide: ENRICH_LINK_QUEUE_PUBLISHER,
            useClass: BullmqEnrichLinkQueuePublisher,
          },
          {
            provide: FRESHNESS_NOTIFY_QUEUE,
            useClass: BullmqFreshnessNotifyPublisher,
          },
          LinkFreshnessScheduler,
          {
            provide: FreshnessQueueCloser,
            inject: [
              FRESHNESS_ENRICH_QUEUE_TOKEN,
              FRESHNESS_NOTIFY_QUEUE_TOKEN,
              FRESHNESS_REDIS,
            ],
            useFactory: (enrich: Queue, notify: Queue, redis: Redis) =>
              new FreshnessQueueCloser(enrich, notify, redis),
          },
        ]
      : [
          {
            provide: FRESHNESS_ENRICHMENT_NOTIFIER,
            useValue: { publish: async () => undefined },
          },
          {
            provide: ENRICH_LINK_QUEUE_PUBLISHER,
            useValue: { add: async () => undefined },
          },
          {
            provide: FRESHNESS_NOTIFY_QUEUE,
            useValue: { add: async () => undefined },
          },
        ];

    return {
      module: FreshnessModule,
      imports: [searchModule],
      providers: [...shared, ...queueProviders],
      exports: [
        CLOSE_JOB_LINK,
        EXPIRE_APPLICATIONS_FOR_CLOSED_LINK,
        FRESHNESS_LINK_STORE,
      ],
    };
  }
}
