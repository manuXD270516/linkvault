import type { RoadmapItem } from '@linkvault/shared';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';
import type { StudyRoadmap } from '../../domain/roadmap';

// Puerto de persistencia del roadmap (study-roadmap). Claim = insert único por analysisId.

export const ROADMAP_REPOSITORY = Symbol('ROADMAP_REPOSITORY');

export interface ClaimGeneratingInput {
  readonly id: string;
  readonly analysisId: string;
  readonly userId: string;
  readonly createdAt: Date;
}

export type ClaimResult =
  | { readonly outcome: 'claimed'; readonly roadmap: StudyRoadmap }
  | { readonly outcome: 'exists'; readonly roadmap: StudyRoadmap };

export interface RoadmapRepository {
  nextId(): string;

  /**
   * Inserta `generating` + `RoadmapRequested.v1` en la misma transacción (ADR-009).
   * Duplicate key → `exists` con el documento ya guardado (sin segundo outbox).
   */
  claimGenerating(input: ClaimGeneratingInput): Promise<ClaimResult>;

  findByAnalysisId(analysisId: string): Promise<StudyRoadmap | null>;

  /**
   * Borra roadmaps de esos `analysisId` **dentro** de la sesión (cascada al borrar CV/análisis).
   */
  removeByAnalysisIds(
    analysisIds: readonly string[],
    session: TransactionSession,
  ): Promise<number>;

  /** Solo tests / worker: marca ready. La API no completa roadmaps. */
  markReady?(
    analysisId: string,
    items: readonly RoadmapItem[],
  ): Promise<boolean>;
}
