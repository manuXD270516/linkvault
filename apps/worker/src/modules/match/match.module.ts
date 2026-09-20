import {
  RUN_TASK,
  type RunTaskFn,
} from '@linkvault/ai';
import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { AnalyzeMatchUseCase } from './application/analyze-match.usecase';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from './application/ports/analysis-repository.port';
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
  ANALYSIS_MODEL_NAME,
  analysisSchema,
} from './infrastructure/persistence/analysis.schemas';
import { MongoAiContextReader } from './infrastructure/persistence/mongo-ai-context.reader';
import { MongoAnalysisRepository } from './infrastructure/persistence/mongo-analysis.repository';
import { MongoCvTextReader } from './infrastructure/persistence/mongo-cv-text.reader';
import { MongoJobReader } from './infrastructure/persistence/mongo-job.reader';
import { AnalyzeMatchConsumer } from './infrastructure/queue/analyze-match.consumer';
import { SystemClock } from './infrastructure/system-clock';

// Módulo `match` del worker (tarea 13.14): ejecución de `match-cv` sobre la cola `analyze-match`.
//
// **El consumidor no se registra en los tests** (`NODE_ENV=test`): un `Worker` abre Redis al crearse.
// `aiModule` es el mismo DynamicModule que importa `AppModule`: `RUN_TASK` solo se resuelve si se importa aquí.

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
        ]),
      ],
      providers: [
        { provide: MATCH_CLOCK, useClass: SystemClock },
        { provide: ANALYSIS_REPOSITORY, useClass: MongoAnalysisRepository },
        { provide: CV_TEXT_READER, useClass: MongoCvTextReader },
        { provide: JOB_READER, useClass: MongoJobReader },
        { provide: AI_CONTEXT_READER, useClass: MongoAiContextReader },
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
          ],
          useFactory: (
            analyses: AnalysisRepository,
            cvText: CvTextReader,
            jobs: JobReader,
            aiContext: AiContextReader,
            runTask: RunTaskFn,
            clock: Clock,
            worker: WorkerConfig,
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
            ]
          : []),
      ],
    };
  }
}

/** Tipado auxiliar para tests de imports de dominio. */
export type MatchDomainImportProbe = Type<unknown>;
