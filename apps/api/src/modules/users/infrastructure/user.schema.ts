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
  displayName: string;
  aiConsent: { externalProviders: boolean };
  outputLanguage: (typeof OUTPUT_LANGUAGES)[number];
  redactName: boolean;
  createdAt: Date;
}

export const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    passwordChangedAt: { type: Date, required: true },
    displayName: { type: String, required: true },
    aiConsent: {
      type: new Schema(
        { externalProviders: { type: Boolean, required: true } },
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
