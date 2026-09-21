import {
  MATCH_CV_FRAGMENT_MAX_CHARS,
  MATCH_DEGRADED_REASONS,
  MATCH_STEPS,
  type MatchDegradedReason,
  type MatchFailureCode,
  type MatchReport,
  type MatchStep,
} from '@linkvault/shared';
import { Schema, Types } from 'mongoose';

// Vista del worker sobre `ai_analyses` (ADR-030 §13). Solo declara lo que lee y escribe; **nunca hace upsert**
// de un documento completo. La API es dueña del alta.

export const ANALYSIS_MODEL_NAME = 'WorkerAiAnalysis';
export const AI_ANALYSES_COLLECTION = 'ai_analyses';

export const MATCH_ANALYSIS_STATUSES = ['running', 'done', 'failed'] as const;
export const MATCH_FAILURE_CODES = ['internal_error'] as const;

export interface AnalysisDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  linkId: Types.ObjectId;
  cvId: Types.ObjectId;
  status: (typeof MATCH_ANALYSIS_STATUSES)[number];
  step: MatchStep;
  previewVersion: number;
  promptVersion: string;
  provider?: string;
  model?: string;
  report?: MatchReport;
  degraded?: boolean;
  degradedReason?: MatchDegradedReason;
  failureCode?: MatchFailureCode;
  aiQuotaRetryAt?: Date;
  consentRequired: boolean;
  wentExternal: boolean;
  requestedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
}

const evidenceSchema = new Schema(
  {
    jobRequirement: { type: String, required: true },
    importance: { type: String, required: true, enum: ['must', 'nice'] },
    cvFragment: {
      type: String,
      maxlength: MATCH_CV_FRAGMENT_MAX_CHARS,
      default: null,
    },
  },
  { _id: false },
);

const suggestionSchema = new Schema(
  {
    section: { type: String, required: true },
    after: { type: String, required: true },
    reason: { type: String, required: true },
    evidence: { type: evidenceSchema, required: true },
  },
  { _id: false },
);

const missingSkillSchema = new Schema(
  {
    name: { type: String, required: true },
    importance: { type: String, required: true, enum: ['must', 'nice'] },
  },
  { _id: false },
);

const reportSchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    matchedSkills: { type: [String], required: true, default: [] },
    missingSkills: { type: [missingSkillSchema], required: true, default: [] },
    suggestions: { type: [suggestionSchema], required: true, default: [] },
    degraded: { type: Boolean, required: true },
    degradedReason: { type: String, enum: MATCH_DEGRADED_REASONS },
    aiQuotaRetryAt: { type: String },
    /** Score del juez 0–1 (cv-suggestions-review). Opcional: informes previos no lo llevan. */
    judgeScore: { type: Number, min: 0, max: 1 },
    /** Modelo/proveedor del juez que produjo `judgeScore`. */
    judgeModel: { type: String },
  },
  { _id: false },
);

export const analysisSchema = new Schema<AnalysisDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    linkId: { type: Schema.Types.ObjectId, required: true },
    cvId: { type: Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      required: true,
      enum: MATCH_ANALYSIS_STATUSES,
    },
    step: { type: String, required: true, enum: MATCH_STEPS },
    previewVersion: { type: Number, required: true, min: 1 },
    promptVersion: { type: String, required: true },
    provider: { type: String },
    model: { type: String },
    report: { type: reportSchema },
    degraded: { type: Boolean },
    degradedReason: { type: String, enum: MATCH_DEGRADED_REASONS },
    failureCode: { type: String, enum: MATCH_FAILURE_CODES },
    aiQuotaRetryAt: { type: Date },
    consentRequired: { type: Boolean, required: true, default: false },
    wentExternal: { type: Boolean, required: true, default: false },
    requestedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    durationMs: { type: Number, min: 0 },
  },
  {
    bufferCommands: false,
    versionKey: false,
    // `strict: false`: el documento completo lo define `api`; aquí solo tocamos rutas conocidas.
    strict: false,
    collection: AI_ANALYSES_COLLECTION,
  },
);

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

export function toAnalysisObjectId(id: string): Types.ObjectId | null {
  return OBJECT_ID_HEX.test(id) ? new Types.ObjectId(id) : null;
}
