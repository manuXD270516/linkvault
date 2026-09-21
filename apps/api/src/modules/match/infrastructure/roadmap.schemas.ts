import type { RoadmapItem, RoadmapStatus } from '@linkvault/shared';
import { Schema, Types } from 'mongoose';
import { isAnalysisId, isUserId } from '../domain/identifier';

// Colección `roadmaps` (study-roadmap): claim-before-run con índice único por analysisId.

export const ROADMAP_MODEL_NAME = 'StudyRoadmap';
export const ROADMAPS_COLLECTION = 'roadmaps';

export const ROADMAP_ANALYSIS_UNIQUE_KEY: Readonly<Record<string, 1>> = {
  analysisId: 1,
};

export interface RoadmapDocument {
  _id: Types.ObjectId;
  analysisId: Types.ObjectId;
  userId: Types.ObjectId;
  status: RoadmapStatus;
  items?: RoadmapItem[];
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
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  {
    collection: ROADMAPS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
  },
);

roadmapSchema.index(ROADMAP_ANALYSIS_UNIQUE_KEY, { unique: true });

export function toRoadmapObjectId(id: string): Types.ObjectId | null {
  if (!isAnalysisId(id)) {
    return null;
  }
  return new Types.ObjectId(id);
}

export function toUserObjectId(id: string): Types.ObjectId | null {
  if (!isUserId(id)) {
    return null;
  }
  return new Types.ObjectId(id);
}

export function toAnalysisObjectId(id: string): Types.ObjectId | null {
  return toRoadmapObjectId(id);
}
