import { WEEKLY_PLAN_DECISION_TTL_DAYS } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import type {
  StoredWeeklyPlanDecision,
  WeeklyPlanDecisionRepository,
} from '../application/ports/weekly-plan-decision-repository.port';
import { toUserObjectId } from './application.schemas';
import {
  WEEKLY_PLAN_DECISION_MODEL_NAME,
  weeklyPlanDecisionSchema,
  type WeeklyPlanDecisionDocument,
} from './weekly-plan-decision.schemas';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adaptador Mongo de WEEKLY_PLAN_DECISION_REPOSITORY (D5 de weekly-plan). El upsert es atómico sobre el índice único
 * `(userId, weekKey, candidateId)`; la vigencia se filtra con el reloj que llega, no con el monitor TTL.
 */
@Injectable()
export class MongoWeeklyPlanDecisionRepository implements WeeklyPlanDecisionRepository {
  private readonly decisions: Model<WeeklyPlanDecisionDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.decisions =
      (connection.models[WEEKLY_PLAN_DECISION_MODEL_NAME] as
        | Model<WeeklyPlanDecisionDocument>
        | undefined) ??
      connection.model<WeeklyPlanDecisionDocument>(
        WEEKLY_PLAN_DECISION_MODEL_NAME,
        weeklyPlanDecisionSchema,
      );
  }

  async upsert(
    userId: string,
    decision: StoredWeeklyPlanDecision,
  ): Promise<void> {
    const user = toUserObjectId(userId);
    if (user === null) {
      return;
    }
    await this.decisions
      .updateOne(
        {
          userId: user,
          weekKey: decision.weekKey,
          candidateId: decision.candidateId,
        },
        { $set: { decision: decision.decision, decidedAt: decision.decidedAt } },
        { upsert: true },
      )
      .exec();
  }

  async listActive(
    userId: string,
    now: Date,
  ): Promise<StoredWeeklyPlanDecision[]> {
    const user = toUserObjectId(userId);
    if (user === null) {
      return [];
    }
    const since = new Date(
      now.getTime() - WEEKLY_PLAN_DECISION_TTL_DAYS * DAY_MS,
    );
    const documents = await this.decisions
      .find(
        { userId: user, decidedAt: { $gte: since } },
        { weekKey: 1, candidateId: 1, decision: 1, decidedAt: 1 },
      )
      .lean<WeeklyPlanDecisionDocument[]>()
      .exec();
    return documents.map((document) => ({
      candidateId: document.candidateId,
      weekKey: document.weekKey,
      decision: document.decision,
      decidedAt: document.decidedAt,
    }));
  }
}
