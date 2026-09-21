import type { RoadmapResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AnalysisNotFound } from '../domain/errors';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from './ports/analysis-repository.port';
import {
  ROADMAP_REPOSITORY,
  type RoadmapRepository,
} from './ports/roadmap-repository.port';
import { toResponse } from './request-roadmap.usecase';

/**
 * `GET /api/analyses/:analysisId/roadmap` (study-roadmap): dueño; status + ítems si ready.
 */
@Injectable()
export class GetRoadmap {
  constructor(
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    @Inject(ROADMAP_REPOSITORY) private readonly roadmaps: RoadmapRepository,
  ) {}

  async execute(userId: string, analysisId: string): Promise<RoadmapResponse> {
    const analysis = await this.analyses.findById(analysisId);
    if (analysis === null || analysis.userId !== userId) {
      throw new AnalysisNotFound();
    }
    const roadmap = await this.roadmaps.findByAnalysisId(analysisId);
    if (roadmap === null || roadmap.userId !== userId) {
      throw new AnalysisNotFound();
    }
    return toResponse(roadmap);
  }
}
