import { Schema } from 'mongoose';
import { DEGRADED_REASONS } from '../../domain/ai-result';
import {
  USAGE_OUTCOMES,
  type UsageRecord,
} from '../../domain/ports/usage-ledger.port';

// Schema de la colección `ai_usage` (D9 de ai-gateway-core). Solo métricas y el hash de la ejecución: nunca input,
// salida ni prompt. `bufferCommands: false`: sin conexión, una escritura falla enseguida en lugar de quedar en cola.
// Los `enum` salen del dominio: una lista propia aquí se quedó sin `consent_required` (ai-usage-consent-reason).

export const AI_USAGE_MODEL_NAME = 'AiUsage';
export const AI_USAGE_COLLECTION = 'ai_usage';

export type AiUsageDocument = UsageRecord;

export const aiUsageSchema = new Schema<AiUsageDocument>(
  {
    userId: { type: String, required: false },
    task: { type: String, required: true },
    providerId: { type: String, default: null },
    model: { type: String, default: null },
    inputTokens: { type: Number, required: true, min: 0 },
    outputTokens: { type: Number, required: true, min: 0 },
    estCost: { type: Number, required: true, min: 0 },
    latencyMs: { type: Number, required: true, min: 0 },
    outcome: { type: String, required: true, enum: USAGE_OUTCOMES },
    reason: { type: String, required: false, enum: DEGRADED_REASONS },
    promptVersion: { type: String, required: true },
    key: { type: String, required: true },
    at: { type: Date, required: true },
  },
  {
    collection: AI_USAGE_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: true,
  },
);

aiUsageSchema.index({ userId: 1, task: 1, at: -1 });
