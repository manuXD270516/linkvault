import type { RoadmapItem, RoadmapStatus } from '@linkvault/shared';
import { Schema, Types } from 'mongoose';

// Colección `roadmaps` compartida con `api` (study-roadmap).

export const ROADMAP_MODEL_NAME = 'StudyRoadmap';
export const ROADMAPS_COLLECTION = 'roadmaps';

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

export interface RoadmapDocument {
  _id: Types.ObjectId;
  analysisId: Types.ObjectId;
  userId: Types.ObjectId;
  status: RoadmapStatus;
  items?: RoadmapItem[];
  /** Presente cuando un worker ya tomó la ejecución (anti doble LLM). */
  buildStartedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const resourceSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['course', 'post', 'book', 'doc', 'video'],
    },
    title: { type: String, required: true },
    url: { type: String, default: null },
    provider: { type: String, required: true },
    free: { type: Boolean, required: true },
    verified: { type: Boolean, required: true },
  },
  { _id: false },
);

const itemSchema = new Schema(
  {
    skill: { type: String, required: true },
    priority: { type: Number, required: true },
    estimatedWeeks: { type: Number, required: true },
    resources: { type: [resourceSchema], required: true },
  },
  { _id: false },
);

export const roadmapSchema = new Schema<RoadmapDocument>(
  {
    analysisId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      required: true,
      enum: ['generating', 'ready', 'failed'],
    },
    items: { type: [itemSchema], required: false },
    buildStartedAt: { type: Date, required: false },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  {
    collection: ROADMAPS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
  },
);

roadmapSchema.index({ analysisId: 1 }, { unique: true });

export function toObjectId(id: string): Types.ObjectId | null {
  if (!OBJECT_ID_HEX.test(id)) {
    return null;
  }
  return new Types.ObjectId(id);
}
