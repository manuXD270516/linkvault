import type {
  RoadmapAccepted,
  RoadmapResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AnalysisNotFound, RoadmapNotEligible } from '../domain/errors';
import type { MatchAnalysis } from '../domain/analysis';
import type { StudyRoadmap } from '../domain/roadmap';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from './ports/analysis-repository.port';
import { MATCH_CLOCK, type MatchClock } from './ports/clock.port';
import {
  ROADMAP_REPOSITORY,
  type RoadmapRepository,
} from './ports/roadmap-repository.port';

/**
 * Resultado de pedir un roadmap. `accepted` → HTTP 202 (claim ganado); `reused` → HTTP 200 (ya existía).
 */
export type RequestRoadmapResult =
  | { readonly outcome: 'accepted'; readonly body: RoadmapAccepted }
  | { readonly outcome: 'reused'; readonly body: RoadmapResponse };

/**
 * `POST /api/analyses/:analysisId/roadmap` (study-roadmap): claim-before-run + outbox.
 * No llama al LLM; el worker ejecuta `build-roadmap`.
 */
@Injectable()
export class RequestRoadmap {
  constructor(
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    @Inject(ROADMAP_REPOSITORY) private readonly roadmaps: RoadmapRepository,
    @Inject(MATCH_CLOCK) private readonly clock: MatchClock,
  ) {}

  async execute(
    userId: string,
    analysisId: string,
  ): Promise<RequestRoadmapResult> {
    const analysis = await this.analyses.findById(analysisId);
    if (analysis === null || analysis.userId !== userId) {
      throw new AnalysisNotFound();
    }
    assertEligibleForRoadmap(analysis);

    const existing = await this.roadmaps.findByAnalysisId(analysisId);
    if (existing !== null) {
      return { outcome: 'reused', body: toResponse(existing) };
    }

    const claimed = await this.roadmaps.claimGenerating({
      id: this.roadmaps.nextId(),
      analysisId,
      userId,
      createdAt: this.clock.now(),
    });
    if (claimed.outcome === 'exists') {
      return { outcome: 'reused', body: toResponse(claimed.roadmap) };
    }
    return {
      outcome: 'accepted',
      body: {
        roadmapId: claimed.roadmap.id,
        status: 'generating',
      },
    };
  }
}

export function assertEligibleForRoadmap(analysis: MatchAnalysis): void {
  if (analysis.status !== 'done' || analysis.report === undefined) {
    throw new RoadmapNotEligible();
  }
  if (analysis.report.degraded || analysis.degraded === true) {
    throw new RoadmapNotEligible();
  }
  if (analysis.report.missingSkills.length === 0) {
    throw new RoadmapNotEligible();
  }
}

export function toResponse(roadmap: StudyRoadmap): RoadmapResponse {
  if (roadmap.status === 'ready') {
    return {
      roadmapId: roadmap.id,
      analysisId: roadmap.analysisId,
      status: 'ready',
      items: [...(roadmap.items ?? [])],
    };
  }
  return {
    roadmapId: roadmap.id,
    analysisId: roadmap.analysisId,
    status: roadmap.status,
  };
}
