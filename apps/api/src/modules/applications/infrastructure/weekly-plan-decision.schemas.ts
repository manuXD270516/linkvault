import { WEEKLY_PLAN_DECISION_TTL_DAYS } from '@linkvault/shared';
import { Schema, Types } from 'mongoose';

// Colección `weekly_plan_decisions` (D5 de weekly-plan): una decisión por `(userId, weekKey, candidateId)`, garantizado
// por el índice único, y un TTL de 35 días sobre `decidedAt`. No guarda texto ni nada de otras personas. Los índices los
// crea `autoIndex` al arrancar la api, como el resto de colecciones. `userId` es un `ObjectId`.

export const WEEKLY_PLAN_DECISION_MODEL_NAME = 'WeeklyPlanDecision';
export const WEEKLY_PLAN_DECISIONS_COLLECTION = 'weekly_plan_decisions';

/** `expireAfterSeconds` del índice TTL: 35 días. */
export const WEEKLY_PLAN_DECISION_TTL_SECONDS =
  WEEKLY_PLAN_DECISION_TTL_DAYS * 24 * 60 * 60;

export interface WeeklyPlanDecisionDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  weekKey: string;
  candidateId: string;
  decision: 'done' | 'dismissed' | 'snoozed';
  decidedAt: Date;
}

export const weeklyPlanDecisionSchema = new Schema<WeeklyPlanDecisionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    weekKey: { type: String, required: true },
    candidateId: { type: String, required: true },
    decision: {
      type: String,
      required: true,
      enum: ['done', 'dismissed', 'snoozed'],
    },
    decidedAt: { type: Date, required: true },
  },
  {
    bufferCommands: false,
    versionKey: false,
    strict: true,
    collection: WEEKLY_PLAN_DECISIONS_COLLECTION,
  },
);

weeklyPlanDecisionSchema.index(
  { userId: 1, weekKey: 1, candidateId: 1 },
  { unique: true },
);
weeklyPlanDecisionSchema.index(
  { decidedAt: 1 },
  { expireAfterSeconds: WEEKLY_PLAN_DECISION_TTL_SECONDS },
);
