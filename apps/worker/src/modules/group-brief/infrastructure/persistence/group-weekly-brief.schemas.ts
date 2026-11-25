import { GROUP_BRIEF_TTL_DAYS } from '@linkvault/shared';
import { Schema } from 'mongoose';
import {
  GROUP_WEEKLY_BRIEFS_COLLECTION,
  type GroupWeeklyBriefDocument,
} from './group-weekly-brief.document';

export const GROUP_WEEKLY_BRIEF_MODEL_NAME = 'WorkerGroupWeeklyBrief';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Vista del worker sobre `group_weekly_briefs` (design D1, D2): la colección es del worker. El modelo solo declara
 * los índices; las escrituras van por el driver nativo para que Mongoose no transforme el documento.
 * TTL: 35 días sobre `computedAt` (cambiarlo exige `collMod`, `createIndexes` no modifica un índice existente).
 */
export const groupWeeklyBriefSchema = new Schema<GroupWeeklyBriefDocument>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    weekKey: { type: String, required: true },
    computedAt: { type: Date, required: true },
  },
  {
    bufferCommands: false,
    versionKey: false,
    strict: false,
    collection: GROUP_WEEKLY_BRIEFS_COLLECTION,
  },
);
groupWeeklyBriefSchema.index({ groupId: 1, weekKey: 1 }, { unique: true });
groupWeeklyBriefSchema.index(
  { computedAt: 1 },
  { expireAfterSeconds: GROUP_BRIEF_TTL_DAYS * SECONDS_PER_DAY },
);
