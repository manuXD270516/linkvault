import { RUN_TASK, type RunTaskFn } from '@linkvault/ai';
import { type DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { CLOSE_JOB_LINK } from '../freshness/application/ports/freshness.ports';
import {
  EnrichLinkUseCase,
  type CloseVacancyForRecheck,
} from './application/enrich-link.usecase';
import { ExtractPreviewService } from './application/extract-preview.service';
import { AiExtractJobExtractor } from './application/extractors/ai-extract-job.extractor';
import { CLOCK, type Clock } from './application/ports/clock.port';
import {
  ENRICHMENT_NOTIFIER,
  type EnrichmentNotifier,
} from './application/ports/enrichment-notifier.port';
import {
  HOST_MUTEX,
  type HostMutex,
} from './application/ports/host-mutex.port';
import {
  LINK_REPOSITORY,
  type LinkRepository,
} from './application/ports/link-repository.port';
import {
  PAGE_FETCHER,
  type PageFetcher,
} from './application/ports/page-fetcher.port';
import {
  PAGE_PARSER,
  type PageParser,
} from './application/ports/page-parser.port';
import { ROBOTS, type Robots } from './application/ports/robots.port';
import {
  SNAPSHOT_BUCKET,
  type SnapshotBucket,
} from './application/ports/snapshot-bucket.port';
import {
  SNAPSHOT_STORE,
  type SnapshotStore,
} from './application/ports/snapshot-store.port';
import { SweepExpiredSnapshots } from './application/sweep-expired-snapshots.usecase';
import { ExtractionChain } from './domain/extraction-chain';
import { HeadlessExtractor } from './domain/extractors/headless.extractor';
import { JsonLdExtractor } from './domain/extractors/json-ld.extractor';
import { MetadataExtractor } from './domain/extractors/metadata.extractor';
import { parsePageContent } from './infrastructure/html/page-content';
import {
  HttpPageFetcher,
  type HttpFetch,
} from './infrastructure/http/http-page-fetcher';
import {
  JOB_LINK_MODEL_NAME,
  jobLinkSchema,
} from './infrastructure/persistence/link.schemas';
import { MongoLinkRepository } from './infrastructure/persistence/mongo-link.repository';
import { EnrichLinkConsumer } from './infrastructure/queue/enrich-link.consumer';
import {
  ENRICHMENT_REDIS,
  EnrichmentRedisConnection,
  createEnrichmentRedisClient,
} from './infrastructure/redis/enrichment-redis.client';
import { RedisHostMutex } from './infrastructure/redis/redis-host-mutex';
import { RedisCachedRobots } from './infrastructure/robots/redis-cached-robots';
import { createHttpRobotsFetcher } from './infrastructure/robots/http-robots-fetcher';
import {
  S3SnapshotStore,
  createS3SnapshotUploader,
} from './infrastructure/storage/s3-snapshot.store';
import { RedisEnrichmentNotifier } from './infrastructure/notifications/redis-enrichment-notifier';
import { SnapshotSweepScheduler } from './infrastructure/schedule/snapshot-sweep.scheduler';
import {
  S3SnapshotBucket,
  createS3SnapshotBucketClient,
} from './infrastructure/storage/s3-snapshot.bucket';
import { SystemClock } from './infrastructure/system-clock';

// Módulo del enriquecimiento (D1 de link-enrichment). Aquí se cablea todo: los puertos con sus implementaciones y el
// `Worker` de BullMQ que consume `enrich-link`.
//
// **El consumidor no se registra en los tests.** Un `Worker` abre conexión a Redis nada más crearse, y la suite del
// worker no tiene ninguno: todo lo demás del módulo sí se construye, así que los tests de inyección siguen
// comprobando que el grafo resuelve. Fuera de los tests el consumidor existe siempre; que la cola tenga trabajo o no
// es otra cosa. El cron del barrido de snapshots sigue la misma regla que los demás cron del `worker`.

/** La cadena de D3, en su orden. El orden es el contrato: es lo que decide los empates del merge. */
function extractionChainOf(
  config: WorkerConfig,
  runTask: RunTaskFn,
  clock: Clock,
): ExtractionChain {
  return new ExtractionChain(
    [
      new JsonLdExtractor(),
      new MetadataExtractor(),
      new AiExtractJobExtractor(runTask),
      new HeadlessExtractor(config.FEATURE_HEADLESS_EXTRACTION),
    ],
    () => clock.now().getTime(),
  );
}

@Module({})
export class EnrichmentModule {
  static register(
    config: WorkerConfig,
    aiModule: DynamicModule,
    freshnessModule?: DynamicModule,
  ): DynamicModule {
    // `NODE_ENV=test` es lo único que apaga el consumidor: es la diferencia entre "el proceso existe para consumir" y
    // "la suite no habla con Redis".
    const consumerEnabled = config.NODE_ENV !== 'test';

    return {
      module: EnrichmentModule,
      imports: [
        // `aiModule` es el mismo objeto que importa `AppModule`: `RUN_TASK` solo es visible para quien lo importa.
        aiModule,
        ...(freshnessModule === undefined ? [] : [freshnessModule]),
        MongooseModule.forFeature([
          { name: JOB_LINK_MODEL_NAME, schema: jobLinkSchema },
        ]),
      ],
      providers: [
        { provide: CLOCK, useClass: SystemClock },
        {
          provide: ENRICHMENT_REDIS,
          inject: [APP_CONFIG],
          useFactory: (worker: WorkerConfig) =>
            createEnrichmentRedisClient(worker.REDIS_URL),
        },
        EnrichmentRedisConnection,
        { provide: LINK_REPOSITORY, useClass: MongoLinkRepository },
        {
          provide: ROBOTS,
          inject: [ENRICHMENT_REDIS, APP_CONFIG],
          useFactory: (redis: Redis, worker: WorkerConfig) =>
            new RedisCachedRobots(
              redis,
              createHttpRobotsFetcher({
                userAgent: worker.ENRICH_USER_AGENT,
                timeoutMs: worker.ENRICH_FETCH_TIMEOUT_MS,
              }),
              {
                userAgent: worker.ENRICH_USER_AGENT,
                ttlSeconds: worker.ENRICH_ROBOTS_TTL_SECONDS,
              },
            ),
        },
        {
          provide: HOST_MUTEX,
          inject: [ENRICHMENT_REDIS, APP_CONFIG],
          useFactory: (redis: Redis, worker: WorkerConfig) =>
            new RedisHostMutex(redis, worker.ENRICH_FETCH_TIMEOUT_MS),
        },
        {
          provide: PAGE_FETCHER,
          inject: [APP_CONFIG],
          useFactory: (worker: WorkerConfig) =>
            new HttpPageFetcher(fetch as HttpFetch, {
              userAgent: worker.ENRICH_USER_AGENT,
              timeoutMs: worker.ENRICH_FETCH_TIMEOUT_MS,
              maxBytes: worker.ENRICH_MAX_BYTES,
            }),
        },
        { provide: PAGE_PARSER, useValue: parsePageContent },
        {
          provide: SNAPSHOT_STORE,
          inject: [APP_CONFIG],
          useFactory: (worker: WorkerConfig) =>
            new S3SnapshotStore(
              createS3SnapshotUploader({
                endpoint: worker.S3_ENDPOINT,
                region: worker.S3_REGION,
                accessKey: worker.S3_ACCESS_KEY,
                secretKey: worker.S3_SECRET_KEY,
                bucket: worker.S3_SNAPSHOTS_BUCKET,
              }),
            ),
        },
        {
          // Barrido diario de snapshots (design D7 de `object-store`): lista y borra en el bucket de snapshots, y el caso
          // de uso se niega si es el mismo que el de CV.
          provide: SNAPSHOT_BUCKET,
          inject: [APP_CONFIG],
          useFactory: (worker: WorkerConfig) =>
            new S3SnapshotBucket(
              createS3SnapshotBucketClient({
                endpoint: worker.S3_ENDPOINT,
                region: worker.S3_REGION,
                accessKey: worker.S3_ACCESS_KEY,
                secretKey: worker.S3_SECRET_KEY,
              }),
            ),
        },
        {
          provide: SweepExpiredSnapshots,
          inject: [SNAPSHOT_BUCKET, CLOCK, APP_CONFIG],
          useFactory: (
            bucket: SnapshotBucket,
            clock: Clock,
            worker: WorkerConfig,
          ) =>
            new SweepExpiredSnapshots(bucket, clock, {
              snapshotsBucket: worker.S3_SNAPSHOTS_BUCKET,
              cvBucket: worker.S3_BUCKET,
            }),
        },
        {
          // Publica en el canal que `api` reparte por SSE (D9). Comparte el cliente del módulo porque solo publica: el
          // que necesita conexión propia es el suscriptor de `api`, que en modo suscripción deja de aceptar comandos.
          provide: ENRICHMENT_NOTIFIER,
          inject: [ENRICHMENT_REDIS],
          useFactory: (redis: Redis) => new RedisEnrichmentNotifier(redis),
        },
        {
          provide: ExtractionChain,
          inject: [APP_CONFIG, RUN_TASK, CLOCK],
          useFactory: extractionChainOf,
        },
        {
          provide: ExtractPreviewService,
          inject: [
            ROBOTS,
            HOST_MUTEX,
            PAGE_FETCHER,
            PAGE_PARSER,
            ExtractionChain,
            CLOCK,
            APP_CONFIG,
          ],
          useFactory: (
            robots: Robots,
            hostMutex: HostMutex,
            pageFetcher: PageFetcher,
            pageParser: PageParser,
            chain: ExtractionChain,
            clock: Clock,
            worker: WorkerConfig,
          ) =>
            new ExtractPreviewService(
              robots,
              hostMutex,
              pageFetcher,
              pageParser,
              chain,
              () => clock.now().getTime(),
              {
                fetchTimeoutMs: worker.ENRICH_FETCH_TIMEOUT_MS,
                domainDelayMs: worker.ENRICH_DOMAIN_DELAY_MS,
                maxDeferrals: worker.ENRICH_MAX_DEFERRALS,
              },
            ),
        },
        {
          provide: EnrichLinkUseCase,
          inject: [
            LINK_REPOSITORY,
            ExtractPreviewService,
            SNAPSHOT_STORE,
            ENRICHMENT_NOTIFIER,
            CLOCK,
            APP_CONFIG,
            ...(freshnessModule === undefined ? [] : [CLOSE_JOB_LINK]),
          ],
          useFactory: (
            links: LinkRepository,
            extractPreview: ExtractPreviewService,
            snapshots: SnapshotStore,
            notifier: EnrichmentNotifier,
            clock: Clock,
            worker: WorkerConfig,
            closeVacancy?: CloseVacancyForRecheck,
          ) =>
            new EnrichLinkUseCase(
              links,
              extractPreview,
              snapshots,
              notifier,
              clock,
              worker.ENRICH_DEADLINE_MS,
              closeVacancy ?? null,
            ),
        },
        ...(consumerEnabled
          ? [
              {
                provide: EnrichLinkConsumer,
                inject: [EnrichLinkUseCase, APP_CONFIG],
                useFactory: (
                  useCase: EnrichLinkUseCase,
                  worker: WorkerConfig,
                ) =>
                  new EnrichLinkConsumer(useCase, {
                    redisUrl: worker.REDIS_URL,
                    concurrency: worker.ENRICH_CONCURRENCY,
                    deadlineMs: worker.ENRICH_DEADLINE_MS,
                  }),
              },
              SnapshotSweepScheduler,
            ]
          : []),
      ],
    };
  }
}
