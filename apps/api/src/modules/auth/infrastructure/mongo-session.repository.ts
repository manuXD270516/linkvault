import { randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Model, Schema } from 'mongoose';
import type {
  OpenedSession,
  RotateRefreshToken,
  RotationResult,
  SessionRepository,
  StoredRefreshToken,
} from '../application/ports/session-repository.port';
import type { Clock } from '../domain/clock';
import type { RefreshSessionPolicy } from '../domain/refresh-session';
import {
  AUTH_SESSION_MODEL_NAME,
  authSessionSchema,
  REFRESH_TOKEN_MODEL_NAME,
  refreshTokenSchema,
  type AuthSessionDocument,
  type RefreshTokenDocument,
} from './session.schemas';

// Adaptador SESSION_REPOSITORY en MongoDB (D4 de auth-users, ADR-020) sobre la conexión Mongoose de la app. Las reglas
// de validez, conflicto, reuso y caducidad son de `RefreshSessionPolicy`; aquí solo se leen y escriben documentos.

function modelOf<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}

export class MongoSessionRepository implements SessionRepository {
  private readonly sessions: Model<AuthSessionDocument>;
  private readonly tokens: Model<RefreshTokenDocument>;

  constructor(
    private readonly connection: Connection,
    private readonly policy: RefreshSessionPolicy,
    private readonly clock: Clock,
  ) {
    this.sessions = modelOf<AuthSessionDocument>(
      connection,
      AUTH_SESSION_MODEL_NAME,
      authSessionSchema,
    );
    this.tokens = modelOf<RefreshTokenDocument>(
      connection,
      REFRESH_TOKEN_MODEL_NAME,
      refreshTokenSchema,
    );
  }

  async open(userId: string, refreshTokenHash: string): Promise<OpenedSession> {
    const window = this.policy.openSession();
    const sessionId = randomUUID();
    // Sesión y primer token en la misma transacción: nunca queda una sesión sin token ni un token sin sesión.
    await this.withTransaction(async (session) => {
      await this.sessions.create(
        [
          {
            _id: sessionId,
            userId,
            createdAt: window.createdAt,
            expiresAt: window.expiresAt,
            revokedAt: null,
          },
        ],
        { session },
      );
      await this.tokens.create(
        [
          {
            tokenHash: refreshTokenHash,
            sessionId,
            userId,
            createdAt: window.createdAt,
            expiresAt: window.refreshExpiresAt,
            rotatedAt: null,
            replacedByHash: null,
          },
        ],
        { session },
      );
    });
    return {
      sessionId,
      userId,
      expiresAt: window.expiresAt,
      refreshExpiresAt: window.refreshExpiresAt,
    };
  }

  async findRefreshToken(
    tokenHash: string,
  ): Promise<StoredRefreshToken | null> {
    const document = await this.tokens.findOne({ tokenHash }).lean().exec();
    return document ? toStoredRefreshToken(document) : null;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sessions
      .updateOne(
        { _id: sessionId, revokedAt: null },
        { $set: { revokedAt: this.clock.now() } },
      )
      .exec();
  }

  async revokeUserSessionsExcept(
    userId: string,
    keepSessionId: string,
  ): Promise<number> {
    const result = await this.sessions
      .updateMany(
        { userId, _id: { $ne: keepSessionId }, revokedAt: null },
        { $set: { revokedAt: this.clock.now() } },
      )
      .exec();
    return result.modifiedCount;
  }

  async revokeAllUserSessions(userId: string): Promise<number> {
    const result = await this.sessions
      .updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: this.clock.now() } },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * Rotación (D4). Dentro de `withTransaction`, que reintenta ante `WriteConflict`: de dos rotaciones concurrentes, la
   * perdedora relee el token ya marcado y devuelve `conflict`. El callback devuelve el resultado en lugar de lanzar, para
   * que la revocación por reuso se confirme.
   */
  rotate({
    tokenHash,
    successorHash,
  }: RotateRefreshToken): Promise<RotationResult> {
    return this.withTransaction(async (session) => {
      // 1. Token por hash y su sesión.
      const token = await this.tokens
        .findOne({ tokenHash })
        .session(session)
        .lean()
        .exec();
      if (!token) {
        return { outcome: 'invalid', reason: 'unknown_token' };
      }
      const stored = await this.sessions
        .findById(token.sessionId)
        .session(session)
        .lean()
        .exec();
      const identity = { sessionId: token.sessionId, userId: token.userId };

      // 1–2. Validez, ventana de conflicto y reuso: reglas del dominio.
      const decision = this.policy.decide(token, stored);
      switch (decision.outcome) {
        case 'invalid':
          return decision;
        case 'conflict':
          return { outcome: 'conflict', ...identity };
        case 'reuse':
          await this.sessions
            .updateOne(
              { _id: token.sessionId, revokedAt: null },
              { $set: { revokedAt: this.clock.now() } },
            )
            .session(session)
            .exec();
          return { outcome: 'reused', ...identity };
        case 'rotate':
          break;
      }

      // 3. Marcar el token como rotado solo si nadie lo ha hecho antes.
      const marked = await this.tokens
        .updateOne(
          { tokenHash, rotatedAt: null },
          { $set: { rotatedAt: decision.now, replacedByHash: successorHash } },
        )
        .session(session)
        .exec();
      if (marked.modifiedCount !== 1) {
        return { outcome: 'conflict', ...identity };
      }

      // 4. Recomprobar la sesión e insertar el sucesor, con caducidad deslizante acotada por el máximo de la sesión.
      const current = await this.sessions
        .findById(token.sessionId)
        .session(session)
        .lean()
        .exec();
      if (!this.policy.isSessionActive(current)) {
        return {
          outcome: 'invalid',
          reason: !current
            ? 'session_missing'
            : current.revokedAt !== null
              ? 'session_revoked'
              : 'session_expired',
        };
      }
      await this.tokens.create(
        [
          {
            tokenHash: successorHash,
            sessionId: token.sessionId,
            userId: token.userId,
            createdAt: decision.now,
            expiresAt: decision.successorExpiresAt,
            rotatedAt: null,
            replacedByHash: null,
          },
        ],
        { session },
      );
      return {
        outcome: 'rotated',
        ...identity,
        refreshExpiresAt: decision.successorExpiresAt,
      };
    });
  }

  private async withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }
}

function toStoredRefreshToken(
  document: RefreshTokenDocument,
): StoredRefreshToken {
  return {
    tokenHash: document.tokenHash,
    sessionId: document.sessionId,
    userId: document.userId,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    rotatedAt: document.rotatedAt,
    replacedByHash: document.replacedByHash,
  };
}
