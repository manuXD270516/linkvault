import { Schema } from 'mongoose';
import type { SessionClient } from '../domain/session-client';

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
  /**
   * Cliente que abrió la familia (ADR-038). Ausente en documentos legacy ≡ `web`
   * (`resolveSessionClient`).
   */
  client?: SessionClient;
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
  /**
   * Hash del token que originó este (`null` en login, registro y tokens anteriores a la reemisión). Los hijos del mismo
   * padre son hermanos (D3 de session-refresh-abort).
   */
  parentHash?: string | null;
  /** La familia ya avanzó más allá de este token: su sucesor se usó o el token quedó superado. */
  advancedAt?: Date | null;
  /**
   * Reemisiones hechas. **Sin valor por defecto**: que falte distingue un token rotado por una versión sin reemisión
   * (nunca se reemite) de uno con 0; solo la rotación lo escribe.
   */
  reissueCount?: number;
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
    client: { type: String, enum: ['web', 'extension'], required: false },
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
    parentHash: { type: String, default: null },
    advancedAt: { type: Date, default: null },
    reissueCount: { type: Number, required: false },
  },
  { ...schemaOptions, collection: REFRESH_TOKENS_COLLECTION },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Supersesión de hermanos al rotar uno de ellos (D3 de session-refresh-abort). No único: un padre tiene varios hijos.
refreshTokenSchema.index({ parentHash: 1 });
