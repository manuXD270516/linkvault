import { WEEKLY_PLAN_DECISION_TTL_DAYS } from '@linkvault/shared';
import { isUserId } from '../../domain/identifier';
import type {
  StoredWeeklyPlanDecision,
  WeeklyPlanDecisionRepository,
} from '../ports/weekly-plan-decision-repository.port';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Doble en memoria de `WEEKLY_PLAN_DECISION_REPOSITORY`: misma clave única y mismo filtro de vigencia que Mongo. */
export class InMemoryWeeklyPlanDecisionRepository implements WeeklyPlanDecisionRepository {
  private readonly documents = new Map<
    string,
    { userId: string; decision: StoredWeeklyPlanDecision }
  >();
  upsertCalls = 0;

  upsert(userId: string, decision: StoredWeeklyPlanDecision): Promise<void> {
    this.upsertCalls += 1;
    if (isUserId(userId)) {
      this.documents.set(
        `${userId}|${decision.weekKey}|${decision.candidateId}`,
        { userId, decision: { ...decision } },
      );
    }
    return Promise.resolve();
  }

  listActive(userId: string, now: Date): Promise<StoredWeeklyPlanDecision[]> {
    const limit = now.getTime() - WEEKLY_PLAN_DECISION_TTL_DAYS * DAY_MS;
    return Promise.resolve(
      [...this.documents.values()]
        .filter(
          (document) =>
            document.userId === userId &&
            document.decision.decidedAt.getTime() >= limit,
        )
        .map((document) => ({ ...document.decision })),
    );
  }

  /** Todos los documentos, de cualquier persona: para que un test compruebe que no se escribió nada. */
  count(): number {
    return this.documents.size;
  }
}
