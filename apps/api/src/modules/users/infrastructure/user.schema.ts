import { Schema, type Types } from 'mongoose';
import { OUTPUT_LANGUAGES } from '../domain/user-profile';

// Schema de la colección `users` (D1 de auth-users). `users` es dueño del documento completo, incluidos el hash y
// `passwordChangedAt`. `email` se guarda ya normalizado y lleva el índice único: dos altas concurrentes con el mismo
// email no pueden ganar ambas. `bufferCommands: false`: sin conexión, una operación falla enseguida en lugar de quedar
// en cola.

export const USER_MODEL_NAME = 'User';
export const USERS_COLLECTION = 'users';

export interface UserDocument {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  passwordChangedAt: Date;
  /** Ausente en documentos previos al change → lectura como `true` (ADR-034 D7). */
  emailVerified?: boolean;
  displayName: string;
  aiConsent: {
    externalProviders: boolean;
    consentedAt: Date | null;
    textVersion: string | null;
  };
  outputLanguage: (typeof OUTPUT_LANGUAGES)[number];
  redactName: boolean;
  createdAt: Date;
}

export const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    passwordChangedAt: { type: Date, required: true },
    emailVerified: { type: Boolean, required: false },
    displayName: { type: String, required: true },
    aiConsent: {
      type: new Schema(
        {
          externalProviders: { type: Boolean, required: true },
          consentedAt: { type: Date, default: null },
          textVersion: { type: String, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    outputLanguage: { type: String, required: true, enum: OUTPUT_LANGUAGES },
    redactName: { type: Boolean, required: true },
    createdAt: { type: Date, required: true },
  },
  {
    collection: USERS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: true,
  },
);

userSchema.index({ email: 1 }, { unique: true });
