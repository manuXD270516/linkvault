import {
  RUN_TASK,
  type RunTaskFn,
} from '@linkvault/ai';
import type { Redis } from 'ioredis';
import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { AnalyzeMatchUseCase } from './application/analyze-match.usecase';
import { BuildRoadmapUseCase } from './application/build-roadmap.usecase';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from './application/ports/analysis-repository.port';
import {
  ANALYSIS_STEP_NOTIFIER,
  type AnalysisStepNotifier,
} from './application/ports/analysis-step-notifier.port';
import {
  AI_CONTEXT_READER,
  type AiContextReader,
} from './application/ports/ai-context-reader.port';
import { MATCH_CLOCK, type Clock } from './application/ports/clock.port';
import {
  CV_TEXT_READER,
  type CvTextReader,
} from './application/ports/cv-text-reader.port';
import {
  JOB_READER,
  type JobReader,
} from './application/ports/job-reader.port';
import {
  ROADMAP_JOB_PUBLISHER,
  type RoadmapJobPublisher,
} from './application/ports/roadmap-job-publisher.port';
import {
  ROADMAP_REPOSITORY,
  type RoadmapRepository,
} from './application/ports/roadmap-repository.port';
import {
  ANALYSIS_MODEL_NAME,
  analysisSchema,
} from './infrastructure/persistence/analysis.schemas';
import { MongoAiContextReader } from './infrastructure/persistence/mongo-ai-context.reader';
import { MongoAnalysisRepository } from './infrastructure/persistence/mongo-analysis.repository';
import { MongoCvTextReader } from './infrastructure/persistence/mongo-cv-text.reader';
import { MongoJobReader } from './infrastructure/persistence/mongo-job.reader';
import { MongoRoadmapRepository } from './infrastructure/persistence/mongo-roadmap.repository';
import {
  ROADMAP_MODEL_NAME,
  roadmapSchema,
} from './infrastructure/persistence/roadmap.schemas';
import { RedisAnalysisStepNotifier } from './infrastructure/notifications/redis-analysis-step-notifier';
import { AnalyzeMatchConsumer } from './infrastructure/queue/analyze-match.consumer';
import { BuildRoadmapConsumer } from './infrastructure/queue/build-roadmap.consumer';
import { BullmqRoadmapJobPublisher } from './infrastructure/queue/bullmq-roadmap-job-publisher';
import {
  MATCH_REDIS,
  MatchRedisConnection,
  createMatchRedisClient,
} from './infrastructure/redis/match-redis.client';
import { SystemClock } from './infrastructure/system-clock';

// Módulo `match` del worker: `analyze-match` + `build-roadmap` (study-roadmap).
//
// **Los consumidores no se registran en los tests** (`NODE_ENV=test`): un `Worker` abre Redis al crearse.
// El publisher de roadmap sí se registra siempre (doble sustituible en tests del caso de uso).

@Module({})
export class MatchModule {
  static register(
    config: WorkerConfig,
    aiModule: DynamicModule,
  ): DynamicModule {
    const consumersEnabled = config.NODE_ENV !== 'test';

    return {
      module: MatchModule,
      imports: [
        aiModule,
        MongooseModule.forFeature([
          { name: ANALYSIS_MODEL_NAME, schema: analysisSchema },
          { name: ROADMAP_MODEL_NAME, schema: roadmapSchema },
        ]),
      ],
      providers: [
        { provide: MATCH_CLOCK, useClass: SystemClock },
        { provide: ANALYSIS_REPOSITORY, useClass: MongoAnalysisRepository },
        { provide: ROADMAP_REPOSITORY, useClass: MongoRoadmapRepository },
        { provide: CV_TEXT_READER, useClass: MongoCvTextReader },
        { provide: JOB_READER, useClass: MongoJobReader },
        { provide: AI_CONTEXT_READER, useClass: MongoAiContextReader },
        {
          provide: MATCH_REDIS,
          inject: [APP_CONFIG],
          useFactory: (worker: WorkerConfig) =>
            createMatchRedisClient(worker.REDIS_URL),
        },
        MatchRedisConnection,
        {
          provide: ANALYSIS_STEP_NOTIFIER,
          inject: [MATCH_REDIS],
          useFactory: (redis: Redis) => new RedisAnalysisStepNotifier(redis),
        },
        {
          provide: ROADMAP_JOB_PUBLISHER,
          inject: [APP_CONFIG],
          useFactory: (worker: WorkerConfig) =>
            consumersEnabled
              ? new BullmqRoadmapJobPublisher(worker.REDIS_URL)
              : {
                  enqueue: async () => {
                    /* tests: no Redis */
                  },
                },
        },
        {
          provide: AnalyzeMatchUseCase,
          inject: [
            ANALYSIS_REPOSITORY,
            CV_TEXT_READER,
            JOB_READER,
            AI_CONTEXT_READER,
            RUN_TASK,
            MATCH_CLOCK,
            APP_CONFIG,
            ANALYSIS_STEP_NOTIFIER,
            ROADMAP_JOB_PUBLISHER,
          ],
          useFactory: (
            analyses: AnalysisRepository,
            cvText: CvTextReader,
            jobs: JobReader,
            aiContext: AiContextReader,
            runTask: RunTaskFn,
            clock: Clock,
            worker: WorkerConfig,
            stepNotifier: AnalysisStepNotifier,
            roadmapJobs: RoadmapJobPublisher,
          ) =>
            new AnalyzeMatchUseCase(
              analyses,
              cvText,
              jobs,
              aiContext,
              runTask,
              clock,
              {
                timeoutMs: worker.MATCH_ANALYSIS_TIMEOUT_MS,
                maxAgeMs: worker.MATCH_ANALYSIS_MAX_AGE_MS,
              },
              stepNotifier,
              roadmapJobs,
            ),
        },
        {
          provide: BuildRoadmapUseCase,
          inject: [
            ANALYSIS_REPOSITORY,
            ROADMAP_REPOSITORY,
            JOB_READER,
            AI_CONTEXT_READER,
            RUN_TASK,
            MATCH_CLOCK,
            APP_CONFIG,
          ],
          useFactory: (
            analyses: AnalysisRepository,
            roadmaps: RoadmapRepository,
            jobs: JobReader,
            aiContext: AiContextReader,
            runTask: RunTaskFn,
            clock: Clock,
            worker: WorkerConfig,
          ) =>
            new BuildRoadmapUseCase(
              analyses,
              roadmaps,
              jobs,
              aiContext,
              runTask,
              clock,
              { timeoutMs: worker.MATCH_ANALYSIS_TIMEOUT_MS },
            ),
        },
        ...(consumersEnabled
          ? [
              {
                provide: AnalyzeMatchConsumer,
                inject: [AnalyzeMatchUseCase, APP_CONFIG],
                useFactory: (
                  useCase: AnalyzeMatchUseCase,
                  worker: WorkerConfig,
                ) =>
                  new AnalyzeMatchConsumer(useCase, {
                    redisUrl: worker.REDIS_URL,
                    concurrency: worker.MATCH_ANALYSIS_CONCURRENCY,
                    timeoutMs: worker.MATCH_ANALYSIS_TIMEOUT_MS,
                  }),
              },
              {
                provide: BuildRoadmapConsumer,
                inject: [BuildRoadmapUseCase, APP_CONFIG],
                useFactory: (
                  useCase: BuildRoadmapUseCase,
                  worker: WorkerConfig,
                ) =>
                  new BuildRoadmapConsumer(useCase, {
                    redisUrl: worker.REDIS_URL,
                    concurrency: worker.MATCH_ANALYSIS_CONCURRENCY,
                    timeoutMs: worker.MATCH_ANALYSIS_TIMEOUT_MS,
                  }),
              },
            ]
          : []),
      ],
    };
  }
}

/** Tipado auxiliar para tests de imports de dominio. */
export type MatchDomainImportProbe = Type<unknown>;
