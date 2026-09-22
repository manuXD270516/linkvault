import { Schema, type Types } from 'mongoose';
import type { EmailTokenPurpose } from '../application/ports/email-token-repository.port';

export const AUTH_EMAIL_TOKEN_MODEL_NAME = 'AuthEmailToken';
export const AUTH_EMAIL_TOKENS_COLLECTION = 'auth_email_tokens';

export interface AuthEmailTokenDocument {
  _id: Types.ObjectId;
  tokenHash: string;
  userId: string;
  purpose: EmailTokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export const authEmailTokenSchema = new Schema<AuthEmailTokenDocument>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: String, required: true },
    purpose: {
      type: String,
      required: true,
      enum: ['verify_email', 'reset_password'],
    },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  {
    collection: AUTH_EMAIL_TOKENS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: true,
  },
);

authEmailTokenSchema.index({ tokenHash: 1 }, { unique: true });
authEmailTokenSchema.index({ userId: 1, purpose: 1, usedAt: 1 });
// Limpieza TTL: Mongo borra tras expiresAt; la validez se comprueba también en código.
authEmailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
