import { matchCvTask } from '@linkvault/ai';
import {
  Module,
  type DynamicModule,
  type OnModuleInit,
} from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { ApplicationFitScores } from '../../applications/application/application-fit-scores';
import { CvAnalysisCounts } from '../../cv/application/cv-analysis-counts';
import { CvDeletionHooks } from '../../cv/application/cv-deletion-hooks';
import { CvModule } from '../../cv/presentation/cv.module';
import { UsersModule } from '../../users/presentation/users.module';
import { GetMatchAnalysis } from '../application/get-match-analysis.usecase';
import { ANALYSIS_REPOSITORY } from '../application/ports/analysis-repository.port';
import { MATCH_AI_CONSENT } from '../application/ports/ai-consent.port';
import { MATCH_CLOCK } from '../application/ports/clock.port';
import { MATCH_CV_READER } from '../application/ports/cv-reader.port';
import { MATCH_JOB_READER } from '../application/ports/job-reader.port';
import {
  MATCH_ANALYSIS_SETTINGS,
  type MatchAnalysisSettings,
} from '../application/ports/match-settings.port';
import { RequestMatchAnalysis } from '../application/request-match-analysis.usecase';
import { CvAnalysesDeletionHook } from '../infrastructure/cv-analyses-deletion.hook';
import { CvFacadeMatchCvReader } from '../infrastructure/cv-facade-match-cv-reader';
import { LinksFacadeMatchJobReader } from '../infrastructure/links-facade-match-job-reader';
import { MatchCvAnalysisCountReader } from '../infrastructure/match-cv-analysis-count-reader';
import { MatchFitScoreReader } from '../infrastructure/match-fit-score-reader';
import { MongoAnalysisRepository } from '../infrastructure/mongo-analysis.repository';
import { SystemMatchClock } from '../infrastructure/system-clock';
import { UsersFacadeMatchAiConsent } from '../infrastructure/users-facade-match-ai-consent';
import { MatchController } from './match.controller';

/**
 * Módulo `match` (casos de uso + HTTP). `LinksModule`, `AiModule` y `ApplicationsModule` llegan por `register(...)` —los
 * mismos objetos que construye `AppModule`— para no duplicar instancias.
 *
 * En `onModuleInit` registra: (1) la purga de análisis al borrar un CV y el recuento por CV (ADR-030 §4 / grupo 11),
 * (2) el lector de puntuaciones en `ApplicationFitScores` (D11 / grupo 12). La dependencia va de `match` hacia `cv` y
 * `applications`; esos módulos no importan a `match`.
 */
@Module({})
export class MatchModule implements OnModuleInit {
  static register(
    linksModule: DynamicModule,
    aiModule: DynamicModule,
    applicationsModule: DynamicModule,
  ): DynamicModule {
    return {
      module: MatchModule,
      imports: [
        OutboxModule,
        CvModule,
        UsersModule,
        linksModule,
        aiModule,
        applicationsModule,
      ],
      controllers: [MatchController],
      providers: [
        { provide: ANALYSIS_REPOSITORY, useClass: MongoAnalysisRepository },
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
        CvAnalysesDeletionHook,
        MatchCvAnalysisCountReader,
        MatchFitScoreReader,
        RequestMatchAnalysis,
        GetMatchAnalysis,
      ],
      exports: [RequestMatchAnalysis, GetMatchAnalysis, ANALYSIS_REPOSITORY],
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
