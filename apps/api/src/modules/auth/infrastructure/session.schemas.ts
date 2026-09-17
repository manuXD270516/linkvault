import { Schema } from 'mongoose';

// Colecciones del módulo `auth` (D4 de auth-users). Los índices TTL sobre `expiresAt` solo limpian: la validez se
// comprueba en código (`RefreshSessionPolicy`), porque el monitor TTL de Mongo corre cada 60 s. `bufferCommands: false`:
// sin conexión, una operación falla enseguida en lugar de quedar en cola.

export const AUTH_SESSION_MODEL_NAME = 'AuthSession';
export const AUTH_SESSIONS_COLLECTION = 'auth_sessions';
export const REFRESH_TOKEN_MODEL_NAME = 'RefreshToken';
export const REFRESH_TOKENS_COLLECTION = 'refresh_tokens';

export interface AuthSessionDocument {
  /** Id de la sesión (`sid` del access token). */
  _id: string;
  userId: string;
  createdAt: Date;
  /** Máximo absoluto: `createdAt + AUTH_REFRESH_MAX_DAYS`. */
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RefreshTokenDocument {
  /** `sha256(token)` en hex; el token nunca se guarda. */
  tokenHash: string;
  sessionId: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  replacedByHash: string | null;
}

const schemaOptions = {
  bufferCommands: false,
  versionKey: false,
  strict: true,
} as const;

export const authSessionSchema = new Schema<AuthSessionDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { ...schemaOptions, collection: AUTH_SESSIONS_COLLECTION },
);

// Revocación de todas las sesiones de un usuario (cambio de contraseña).
authSessionSchema.index({ userId: 1 });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    tokenHash: { type: String, required: true },
    sessionId: { type: String, required: true },
    userId: { type: String, required: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
  },
  { ...schemaOptions, collection: REFRESH_TOKENS_COLLECTION },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
