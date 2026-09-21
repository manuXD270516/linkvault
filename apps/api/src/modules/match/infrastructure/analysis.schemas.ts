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
import {
  MATCH_ANALYSIS_STATUSES,
  type MatchAnalysisStatus,
} from '../domain/analysis';
import { isAnalysisId, isCvId, isLinkId, isUserId } from '../domain/identifier';

// Colección `ai_analyses` (D2, D7; ADR-030 §4 y §8).
//
// Guarda el análisis con su informe validado y el `cvFragment` de cada evidencia —**único** texto del CV fuera de
// `cv_documents`, acotado a 300—. **No** declara `cvText`, `jobText`, `prompt` ni ningún campo de credencial.
//
// `bufferCommands: false`: sin conexión, una operación falla enseguida en vez de quedar en cola.

export const ANALYSIS_MODEL_NAME = 'AiAnalysis';
export const AI_ANALYSES_COLLECTION = 'ai_analyses';

/** `keyPattern` del índice que sirve al `GET` por oferta (último resuelto / en curso). */
export const ANALYSIS_LINK_FINISHED_KEY: Readonly<Record<string, 1 | -1>> = {
  userId: 1,
  linkId: 1,
  finishedAt: -1,
};

/** `keyPattern` del índice que sirve el recuento de la cuota. */
export const ANALYSIS_USER_FINISHED_KEY: Readonly<Record<string, 1 | -1>> = {
  userId: 1,
  finishedAt: -1,
};

/** `keyPattern` del índice del borrado en cascada por CV. */
export const ANALYSIS_USER_CV_KEY: Readonly<Record<string, 1>> = {
  userId: 1,
  cvId: 1,
};

export const MATCH_FAILURE_CODES = ['internal_error'] as const;

export interface AnalysisDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  linkId: Types.ObjectId;
  cvId: Types.ObjectId;
  status: MatchAnalysisStatus;
  /** Último paso alcanzado. */
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
    strict: true,
    collection: AI_ANALYSES_COLLECTION,
  },
);

analysisSchema.index({ ...ANALYSIS_LINK_FINISHED_KEY });
analysisSchema.index({ ...ANALYSIS_USER_FINISHED_KEY });
analysisSchema.index({ ...ANALYSIS_USER_CV_KEY });

export function toAnalysisObjectId(id: string): Types.ObjectId | null {
  return isAnalysisId(id) ? new Types.ObjectId(id) : null;
}

export function toUserObjectId(id: string): Types.ObjectId | null {
  return isUserId(id) ? new Types.ObjectId(id) : null;
}

export function toLinkObjectId(id: string): Types.ObjectId | null {
  return isLinkId(id) ? new Types.ObjectId(id) : null;
}

export function toCvObjectId(id: string): Types.ObjectId | null {
  return isCvId(id) ? new Types.ObjectId(id) : null;
}
