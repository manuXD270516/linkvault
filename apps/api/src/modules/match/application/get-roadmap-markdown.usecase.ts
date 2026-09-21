import { Inject, Injectable } from '@nestjs/common';
import { AnalysisNotFound } from '../domain/errors';
import { roadmapToMarkdown } from '../domain/roadmap';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from './ports/analysis-repository.port';
import {
  ROADMAP_REPOSITORY,
  type RoadmapRepository,
} from './ports/roadmap-repository.port';

/**
 * `GET /api/analyses/:analysisId/roadmap.md` (study-roadmap): Markdown si ready; si no, 404.
 */
@Injectable()
export class GetRoadmapMarkdown {
  constructor(
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    @Inject(ROADMAP_REPOSITORY) private readonly roadmaps: RoadmapRepository,
  ) {}

  async execute(userId: string, analysisId: string): Promise<string> {
    const analysis = await this.analyses.findById(analysisId);
    if (analysis === null || analysis.userId !== userId) {
      throw new AnalysisNotFound();
    }
    const roadmap = await this.roadmaps.findByAnalysisId(analysisId);
    if (
      roadmap === null ||
      roadmap.userId !== userId ||
      roadmap.status !== 'ready'
    ) {
      throw new AnalysisNotFound();
    }
    return roadmapToMarkdown(roadmap);
  }
}
