import { Schema } from 'mongoose';
import { AI_VENDORS, type AiVendor } from '@linkvault/shared';

// Colección `user_ai_keys` (ADR-032 D1). Solo ciphertext + hint: nunca la clave en claro.

export const USER_AI_KEY_MODEL_NAME = 'UserAiKey';
export const USER_AI_KEY_COLLECTION = 'user_ai_keys';

export interface UserAiKeyDocument {
  userId: string;
  vendor: AiVendor;
  ciphertext: Buffer;
  keyHint: string;
  updatedAt: Date;
}

export const userAiKeySchema = new Schema<UserAiKeyDocument>(
  {
    userId: { type: String, required: true },
    vendor: { type: String, required: true, enum: AI_VENDORS },
    ciphertext: { type: Buffer, required: true },
    keyHint: { type: String, required: true, minlength: 4, maxlength: 4 },
    updatedAt: { type: Date, required: true },
  },
  {
    collection: USER_AI_KEY_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: true,
  },
);

userAiKeySchema.index({ userId: 1, vendor: 1 }, { unique: true });
