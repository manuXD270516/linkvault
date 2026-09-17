import type { InvalidRefreshReason } from '../../domain/errors';

// Puerto de sesiones y refresh tokens (D4 de auth-users, ADR-020). El repositorio solo ve hashes de refresh tokens,
// nunca su valor. Solo tipos y el token.

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface OpenedSession {
  readonly sessionId: string;
  readonly userId: string;
  /** Máximo absoluto de la sesión. */
  readonly expiresAt: Date;
  /** Caducidad del primer refresh token (Max-Age de la cookie). */
  readonly refreshExpiresAt: Date;
}

export interface StoredRefreshToken {
  readonly tokenHash: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly rotatedAt: Date | null;
  readonly replacedByHash: string | null;
}

export interface RotateRefreshToken {
  /** Hash del refresh token presentado en la cookie. */
  readonly tokenHash: string;
  /** Hash del sucesor, generado por quien llama; solo se guarda si la rotación ocurre. */
  readonly successorHash: string;
}

/** Resultado de la rotación (D4): la transacción lo devuelve y confirma; el código HTTP se decide fuera. */
export type RotationResult =
  | {
      readonly outcome: 'rotated';
      readonly sessionId: string;
      readonly userId: string;
      /** Caducidad del sucesor (Max-Age de la cookie nueva). */
      readonly refreshExpiresAt: Date;
    }
  | {
      readonly outcome: 'conflict';
      readonly sessionId: string;
      readonly userId: string;
    }
  /** Reuso detectado: la sesión ya quedó revocada al confirmar la transacción. */
  | {
      readonly outcome: 'reused';
      readonly sessionId: string;
      readonly userId: string;
    }
  | { readonly outcome: 'invalid'; readonly reason: InvalidRefreshReason };

export interface SessionRepository {
  /** Abre una sesión nueva con su primer refresh token. */
  open(userId: string, refreshTokenHash: string): Promise<OpenedSession>;
  findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null>;
  /** Revoca una sesión con una sola escritura. Idempotente: no cambia `revokedAt` de una sesión ya revocada. */
  revokeSession(sessionId: string): Promise<void>;
  /** Revoca todas las sesiones activas del usuario salvo `keepSessionId`; devuelve cuántas revocó. */
  revokeUserSessionsExcept(
    userId: string,
    keepSessionId: string,
  ): Promise<number>;
  /** Rotación atómica del refresh token presentado (D4). Nunca lanza para señalar reuso. */
  rotate(input: RotateRefreshToken): Promise<RotationResult>;
}
