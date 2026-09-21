import { Inject, Injectable } from '@nestjs/common';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from '../application/ports/analysis-repository.port';
import {
  ROADMAP_REPOSITORY,
  type RoadmapRepository,
} from '../application/ports/roadmap-repository.port';

/**
 * Limpieza de `match` + `roadmaps` cuando se borra un CV (ADR-030 §4, study-roadmap §6):
 * primero los roadmaps de esos análisis, luego los análisis —misma sesión.
 */
@Injectable()
export class CvAnalysesDeletionHook {
  constructor(
    @Inject(ANALYSIS_REPOSITORY)
    private readonly analyses: AnalysisRepository,
    @Inject(ROADMAP_REPOSITORY)
    private readonly roadmaps: RoadmapRepository,
  ) {}

  async deleteRelationsOf(
    cvId: string,
    userId: string,
    session: TransactionSession,
  ): Promise<void> {
    const analysisIds = await this.analyses.findIdsByCv(userId, cvId, session);
    await this.roadmaps.removeByAnalysisIds(analysisIds, session);
    await this.analyses.removeByCv(userId, cvId, session);
  }
}
