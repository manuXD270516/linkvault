import { Types, Schema } from 'mongoose';
import { isAnalysisId, isUserId } from '../domain/identifier';

// Colección `ai_feedback` (cv-suggestions-review B14 / design §9). Solo metadatos: quién, qué análisis, índice y
// hash corto del `after`. **Sin** texto de sugerencia ni del CV.

export const FEEDBACK_MODEL_NAME = 'AiFeedback';
export const AI_FEEDBACK_COLLECTION = 'ai_feedback';

export interface SuggestionFeedbackDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  analysisId: Types.ObjectId;
  suggestionIndex: number;
  afterHash: string;
  createdAt: Date;
}

export const suggestionFeedbackSchema = new Schema<SuggestionFeedbackDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    analysisId: { type: Schema.Types.ObjectId, required: true, index: true },
    suggestionIndex: { type: Number, required: true, min: 0 },
    afterHash: { type: String, required: true, maxlength: 64 },
    createdAt: { type: Date, required: true },
  },
  {
    collection: AI_FEEDBACK_COLLECTION,
    versionKey: false,
    bufferCommands: false,
  },
);

export function toFeedbackObjectId(id: string): Types.ObjectId | null {
  return isAnalysisId(id) ? new Types.ObjectId(id) : null;
}

export function toFeedbackUserObjectId(id: string): Types.ObjectId | null {
  return isUserId(id) ? new Types.ObjectId(id) : null;
}
