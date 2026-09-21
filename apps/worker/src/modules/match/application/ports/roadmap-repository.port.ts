import type { RoadmapItem } from '@linkvault/shared';
import type { StudyRoadmap } from '../../domain/roadmap';

// Puerto del roadmap en el worker (study-roadmap): claim + completar.

export const ROADMAP_REPOSITORY = Symbol('ROADMAP_REPOSITORY');

export type ClaimOutcome =
  | { readonly kind: 'won'; readonly roadmap: StudyRoadmap }
  | { readonly kind: 'lost' }
  | { readonly kind: 'already_generating'; readonly roadmap: StudyRoadmap }
  | { readonly kind: 'already_done' };

export interface RoadmapRepository {
  nextId(): string;

  findByAnalysisId(analysisId: string): Promise<StudyRoadmap | null>;

  /**
   * Si no hay doc → insert generating (won). Si hay generating sin build iniciado →
   * `already_generating`. Si ready/failed → already_done. Duplicate key → lost.
   */
  claimOrGet(input: {
    readonly id: string;
    readonly analysisId: string;
    readonly userId: string;
    readonly createdAt: Date;
  }): Promise<ClaimOutcome>;

  /**
   * Toma la ejecución de un `generating`: solo un worker gana (evita doble LLM cuando
   * POST y auto encolan el mismo analysisId).
   */
  tryBeginBuild(analysisId: string, startedAt: Date): Promise<boolean>;

  markReady(
    analysisId: string,
    items: readonly RoadmapItem[],
    updatedAt: Date,
  ): Promise<boolean>;

  markFailed(analysisId: string, updatedAt: Date): Promise<boolean>;
}
