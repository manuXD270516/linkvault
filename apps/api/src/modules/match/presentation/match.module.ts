import { matchCvTask } from '@linkvault/ai';
import {
  Module,
  type DynamicModule,
  type OnModuleInit,
} from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { RealtimeModule } from '../../../infrastructure/realtime/realtime.module';
import { REDIS_SUBSCRIBER_CLIENT } from '../../../infrastructure/redis/redis-subscriber-client';
import type { RedisSubscriber } from '../../../infrastructure/redis/redis-subscriber-client';
import { ApplicationFitScores } from '../../applications/application/application-fit-scores';
import { CvAnalysisCounts } from '../../cv/application/cv-analysis-counts';
import { CvDeletionHooks } from '../../cv/application/cv-deletion-hooks';
import { UsersModule } from '../../users/presentation/users.module';
import { DeliverAnalysisStep } from '../application/deliver-analysis-step.usecase';
import { GetMatchAnalysis } from '../application/get-match-analysis.usecase';
import { GetRoadmapMarkdown } from '../application/get-roadmap-markdown.usecase';
import { GetRoadmap } from '../application/get-roadmap.usecase';
import { ANALYSIS_REPOSITORY } from '../application/ports/analysis-repository.port';
import { ANALYSIS_STEP_BROADCASTER } from '../application/ports/analysis-step-broadcaster.port';
import { ANALYSIS_STEP_NOTICES } from '../application/ports/analysis-step-notices.port';
import { MATCH_AI_CONSENT } from '../application/ports/ai-consent.port';
import { MATCH_CLOCK } from '../application/ports/clock.port';
import { MATCH_CV_READER } from '../application/ports/cv-reader.port';
import { MATCH_JOB_READER } from '../application/ports/job-reader.port';
import {
  MATCH_ANALYSIS_SETTINGS,
  type MatchAnalysisSettings,
} from '../application/ports/match-settings.port';
import { ROADMAP_REPOSITORY } from '../application/ports/roadmap-repository.port';
import { SUGGESTION_FEEDBACK_REPOSITORY } from '../application/ports/suggestion-feedback-repository.port';
import { RecordSuggestionFeedback } from '../application/record-suggestion-feedback.usecase';
import { RequestMatchAnalysis } from '../application/request-match-analysis.usecase';
import { RequestRoadmap } from '../application/request-roadmap.usecase';
import { AnalysisStepSubscription } from '../infrastructure/analysis-step.subscription';
import { CvAnalysesDeletionHook } from '../infrastructure/cv-analyses-deletion.hook';
import { CvFacadeMatchCvReader } from '../infrastructure/cv-facade-match-cv-reader';
import { EventStreamAnalysisStepBroadcaster } from '../infrastructure/event-stream-analysis-step-broadcaster';
import { LinksFacadeMatchJobReader } from '../infrastructure/links-facade-match-job-reader';
import { MatchCvAnalysisCountReader } from '../infrastructure/match-cv-analysis-count-reader';
import { MatchFitScoreReader } from '../infrastructure/match-fit-score-reader';
import { MongoAnalysisRepository } from '../infrastructure/mongo-analysis.repository';
import { MongoRoadmapRepository } from '../infrastructure/mongo-roadmap.repository';
import { MongoSuggestionFeedbackRepository } from '../infrastructure/mongo-suggestion-feedback.repository';
import { RedisAnalysisStepNotices } from '../infrastructure/redis-analysis-step-notices';
import { SystemMatchClock } from '../infrastructure/system-clock';
import { UsersFacadeMatchAiConsent } from '../infrastructure/users-facade-match-ai-consent';
import { MatchController } from './match.controller';
import { RoadmapController } from './roadmap.controller';
import { SuggestionFeedbackController } from './suggestion-feedback.controller';

/**
 * Módulo `match` (casos de uso + HTTP). `LinksModule`, `AiModule` y `ApplicationsModule` llegan por `register(...)` —los
 * mismos objetos que construye `AppModule`— para no duplicar instancias.
 *
 * Reparte `analysis.step` por SSE (cv-suggestions-review) con el cliente suscriptor exportado por `LinksModule`.
 * Persiste «no me convence» en `ai_feedback` sin mutar el informe.
 */
@Module({})
export class MatchModule implements OnModuleInit {
  static register(
    linksModule: DynamicModule,
    aiModule: DynamicModule,
    applicationsModule: DynamicModule,
    cvModule: DynamicModule,
    searchModule?: DynamicModule,
  ): DynamicModule {
    return {
      module: MatchModule,
      imports: [
        OutboxModule,
        cvModule,
        UsersModule,
        RealtimeModule,
        linksModule,
        aiModule,
        applicationsModule,
        ...(searchModule === undefined ? [] : [searchModule]),
      ],
      controllers: [
        MatchController,
        SuggestionFeedbackController,
        RoadmapController,
      ],
      providers: [
        { provide: ANALYSIS_REPOSITORY, useClass: MongoAnalysisRepository },
        { provide: ROADMAP_REPOSITORY, useClass: MongoRoadmapRepository },
        {
          provide: SUGGESTION_FEEDBACK_REPOSITORY,
          useClass: MongoSuggestionFeedbackRepository,
        },
        { provide: MATCH_JOB_READER, useClass: LinksFacadeMatchJobReader },
        { provide: MATCH_CV_READER, useClass: CvFacadeMatchCvReader },
        { provide: MATCH_AI_CONSENT, useClass: UsersFacadeMatchAiConsent },
        { provide: MATCH_CLOCK, useClass: SystemMatchClock },
        {
          provide: MATCH_ANALYSIS_SETTINGS,
          inject: [APP_CONFIG],
          useFactory: (config: ApiConfig): MatchAnalysisSettings => ({
            maxAgeMs: config.MATCH_ANALYSIS_MAX_AGE_MS,
            quotaWindowMs: config.MATCH_QUOTA_WINDOW_MS,
            analysesPerUser: config.MATCH_ANALYSES_PER_USER,
            promptVersion: matchCvTask.promptVersion,
          }),
        },
        {
          provide: ANALYSIS_STEP_BROADCASTER,
          useClass: EventStreamAnalysisStepBroadcaster,
        },
        {
          // Mismo cliente suscriptor que enriquecimiento y comentarios: una conexión, tres canales.
          provide: ANALYSIS_STEP_NOTICES,
          inject: [REDIS_SUBSCRIBER_CLIENT],
          useFactory: (client: RedisSubscriber) =>
            new RedisAnalysisStepNotices(client),
        },
        DeliverAnalysisStep,
        AnalysisStepSubscription,
        CvAnalysesDeletionHook,
        MatchCvAnalysisCountReader,
        MatchFitScoreReader,
        RequestMatchAnalysis,
        GetMatchAnalysis,
        RecordSuggestionFeedback,
        RequestRoadmap,
        GetRoadmap,
        GetRoadmapMarkdown,
      ],
      exports: [
        RequestMatchAnalysis,
        GetMatchAnalysis,
        ANALYSIS_REPOSITORY,
        ROADMAP_REPOSITORY,
      ],
    };
  }

  constructor(
    private readonly deletionHooks: CvDeletionHooks,
    private readonly cvAnalysesDeletion: CvAnalysesDeletionHook,
    private readonly analysisCounts: CvAnalysisCounts,
    private readonly analysisCountReader: MatchCvAnalysisCountReader,
    private readonly fitScores: ApplicationFitScores,
    private readonly fitScoreReader: MatchFitScoreReader,
  ) {}

  onModuleInit(): void {
    this.deletionHooks.register(this.cvAnalysesDeletion);
    this.analysisCounts.register(this.analysisCountReader);
    this.fitScores.register(this.fitScoreReader);
  }
}
