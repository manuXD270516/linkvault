import type { RoadmapItem, RoadmapStatus } from '@linkvault/shared';

// Entidad del roadmap en el worker (study-roadmap). Claim → ready/failed.

export interface StudyRoadmap {
  readonly id: string;
  readonly analysisId: string;
  readonly userId: string;
  readonly status: RoadmapStatus;
  readonly items?: readonly RoadmapItem[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewGeneratingRoadmap {
  readonly id: string;
  readonly analysisId: string;
  readonly userId: string;
  readonly createdAt: Date;
}

export function createGeneratingRoadmap(
  params: NewGeneratingRoadmap,
): Omit<StudyRoadmap, 'id'> & { readonly id: string } {
  return {
    id: params.id,
    analysisId: params.analysisId,
    userId: params.userId,
    status: 'generating',
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  };
}
