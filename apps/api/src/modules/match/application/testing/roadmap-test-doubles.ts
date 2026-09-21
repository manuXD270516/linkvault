import type { RoadmapItem } from '@linkvault/shared';
import { roadmapRequestedEvent } from '@linkvault/shared';
import type { OutboxEvent } from '../../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';
import { isAnalysisId } from '../../domain/identifier';
import {
  createGeneratingRoadmap,
  type StudyRoadmap,
} from '../../domain/roadmap';
import type {
  ClaimGeneratingInput,
  ClaimResult,
  RoadmapRepository,
} from '../ports/roadmap-repository.port';

/** Doble en memoria del repositorio de roadmaps (study-roadmap). */
export class InMemoryRoadmapRepository implements RoadmapRepository {
  readonly documents = new Map<string, StudyRoadmap>();
  readonly outbox: OutboxEvent[] = [];
  private seq = 0;

  nextId(): string {
    this.seq += 1;
    return `66e9b0000000000000000${String(this.seq).padStart(3, '0')}`;
  }

  async claimGenerating(input: ClaimGeneratingInput): Promise<ClaimResult> {
    for (const doc of this.documents.values()) {
      if (doc.analysisId === input.analysisId) {
        return { outcome: 'exists', roadmap: doc };
      }
    }
    const draft = createGeneratingRoadmap(input);
    this.documents.set(draft.id, draft);
    this.outbox.push(
      roadmapRequestedEvent({
        analysisId: draft.analysisId,
        userId: draft.userId,
      }),
    );
    return { outcome: 'claimed', roadmap: draft };
  }

  findByAnalysisId(analysisId: string): Promise<StudyRoadmap | null> {
    if (!isAnalysisId(analysisId)) {
      return Promise.resolve(null);
    }
    for (const doc of this.documents.values()) {
      if (doc.analysisId === analysisId) {
        return Promise.resolve(doc);
      }
    }
    return Promise.resolve(null);
  }

  removeByAnalysisIds(
    analysisIds: readonly string[],
    _session: TransactionSession,
  ): Promise<number> {
    const wanted = new Set(analysisIds);
    let removed = 0;
    for (const [id, doc] of this.documents) {
      if (wanted.has(doc.analysisId)) {
        this.documents.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  seedReady(
    analysisId: string,
    userId: string,
    items: readonly RoadmapItem[],
  ): StudyRoadmap {
    const id = this.nextId();
    const now = new Date('2026-09-21T12:00:00.000Z');
    const doc: StudyRoadmap = {
      id,
      analysisId,
      userId,
      status: 'ready',
      items,
      createdAt: now,
      updatedAt: now,
    };
    this.documents.set(id, doc);
    return doc;
  }

  seedGenerating(analysisId: string, userId: string): StudyRoadmap {
    const draft = createGeneratingRoadmap({
      id: this.nextId(),
      analysisId,
      userId,
      createdAt: new Date('2026-09-21T12:00:00.000Z'),
    });
    this.documents.set(draft.id, draft);
    return draft;
  }
}
