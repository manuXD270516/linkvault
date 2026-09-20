import { matchCvTask } from '@linkvault/ai';
import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
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
import { CvFacadeMatchCvReader } from '../infrastructure/cv-facade-match-cv-reader';
import { LinksFacadeMatchJobReader } from '../infrastructure/links-facade-match-job-reader';
import { MongoAnalysisRepository } from '../infrastructure/mongo-analysis.repository';
import { SystemMatchClock } from '../infrastructure/system-clock';
import { UsersFacadeMatchAiConsent } from '../infrastructure/users-facade-match-ai-consent';

/**
 * Módulo `match` (casos de uso del grupo 9). Sin controlador HTTP todavía (grupo 10).
 *
 * `LinksModule` y `AiModule` llegan por `register(...)` —los mismos objetos que construye `AppModule`— para no
 * duplicar instancias. El HTTP se cablea en el grupo 10.
 */
@Module({})
export class MatchModule {
  static register(
    linksModule: DynamicModule,
    aiModule: DynamicModule,
  ): DynamicModule {
    return {
      module: MatchModule,
      imports: [OutboxModule, CvModule, UsersModule, linksModule, aiModule],
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
        RequestMatchAnalysis,
        GetMatchAnalysis,
      ],
      exports: [RequestMatchAnalysis, GetMatchAnalysis, ANALYSIS_REPOSITORY],
    };
  }
}
