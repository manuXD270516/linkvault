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
import {
  REFRESH_REISSUE_LIMIT,
  type RefreshSessionPolicy,
} from '../domain/refresh-session';
import {
  resolveSessionClient,
  type SessionClient,
} from '../domain/session-client';
import {
  AUTH_SESSION_MODEL_NAME,
  authSessionSchema,
  REFRESH_TOKEN_MODEL_NAME,
  refreshTokenSchema,
  type AuthSessionDocument,
  type RefreshTokenDocument,
} from './session.schemas';

// Adaptador SESSION_REPOSITORY en MongoDB (D4 de auth-users, ADR-020 + ADR-038) sobre la conexión Mongoose de la app.
// Las reglas de validez, conflicto, reuso y caducidad son de `RefreshSessionPolicy`; aquí solo se leen y escriben
// documentos. El aislamiento `client` (web ↔ extensión) se aplica en `rotate` antes de rotar.

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

/**
 * Punto de pausa **solo para tests** (H3 de session-refresh-abort): `rotate` lo invoca tras leer y decidir, antes de
 * escribir, para intercalar dos transacciones de forma determinista. Ausente en `auth.module.ts`.
 */
export interface RotationProbe {
  afterRead(kind: 'rotate' | 'reissue'): Promise<void>;
}

export class MongoSessionRepository implements SessionRepository {
  private readonly sessions: Model<AuthSessionDocument>;
  private readonly tokens: Model<RefreshTokenDocument>;

  constructor(
    private readonly connection: Connection,
    private readonly policy: RefreshSessionPolicy,
    private readonly clock: Clock,
    private readonly rotationProbe?: RotationProbe,
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

  async open(
    userId: string,
    refreshTokenHash: string,
    client: SessionClient = 'web',
  ): Promise<OpenedSession> {
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
            client,
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
            parentHash: null,
            advancedAt: null,
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
      client,
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
   * Rotación (D4 + ADR-038). Dentro de `withTransaction`, que reintenta ante `WriteConflict`: de dos rotaciones
   * concurrentes, la perdedora relee el token ya marcado y devuelve `conflict`. El callback devuelve el resultado en
   * lugar de lanzar, para que la revocación por reuso se confirme. Cliente distinto al esperado → `invalid` sin tocar
   * el token.
   */
  rotate({
    tokenHash,
    successorHash,
    expectedClient,
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

      if (
        stored !== null &&
        resolveSessionClient(stored.client) !== expectedClient
      ) {
        return { outcome: 'invalid', reason: 'unknown_token' };
      }

      // 1–2. Validez, ventana de conflicto y reuso: reglas del dominio.
      const decision = this.policy.decide(
        {
          ...token,
          advanced: (token.advancedAt ?? null) !== null,
          reissueCount: token.reissueCount ?? null,
        },
        stored,
      );
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
        case 'reissue': {
          await this.rotationProbe?.afterRead('reissue');
          // Respuesta de rotación perdida (ADR-072): el token ya está rotado y su sucesor no se usó. Se emite un
          // hermano sin tocar `rotatedAt`. La escritura sobre el token presentado es condicional: `advancedAt` nulo,
          // contador existente (un token rotado por una versión sin reemisión no lo tiene) y por debajo del tope.
          const bumped = await this.tokens
            .updateOne(
              {
                tokenHash,
                advancedAt: null,
                reissueCount: { $exists: true, $lt: REFRESH_REISSUE_LIMIT },
              },
              { $inc: { reissueCount: 1 } },
            )
            .session(session)
            .exec();
          if (bumped.modifiedCount !== 1) {
            return { outcome: 'conflict', ...identity };
          }
          return this.insertSuccessor(session, {
            ...identity,
            parentHash: tokenHash,
            successorHash,
            now: decision.now,
            successorExpiresAt: decision.successorExpiresAt,
            reissued: true,
            reissueCount: (token.reissueCount ?? 0) + 1,
          });
        }
        case 'rotate':
          await this.rotationProbe?.afterRead('rotate');
          break;
      }

      // 3. Marcar el token como rotado solo si nadie lo ha hecho antes.
      const marked = await this.tokens
        .updateOne(
          { tokenHash, rotatedAt: null },
          {
            $set: {
              rotatedAt: decision.now,
              replacedByHash: successorHash,
              reissueCount: 0,
            },
          },
        )
        .session(session)
        .exec();
      if (marked.modifiedCount !== 1) {
        return { outcome: 'conflict', ...identity };
      }

      // 3b. Primer uso de un hermano (D3 de session-refresh-abort). Se escribe siempre en el padre (`advancedAt` =
      // «la familia ya avanzó»): reemisión y rotación de un hijo chocan en ese documento y la base de datos las
      // serializa; sin esa escritura común, el `updateMany` no vería un hermano insertado en paralelo. Los hermanos
      // sin rotar quedan superados: rotados y avanzados en `now`, sin sucesor.
      if (token.parentHash) {
        await this.tokens
          .updateOne(
            { tokenHash: token.parentHash },
            { $set: { advancedAt: decision.now } },
          )
          .session(session)
          .exec();
        await this.tokens
          .updateMany(
            {
              parentHash: token.parentHash,
              rotatedAt: null,
              tokenHash: { $ne: tokenHash },
            },
            { $set: { rotatedAt: decision.now, advancedAt: decision.now } },
          )
          .session(session)
          .exec();
      }

      // 4. Recomprobar la sesión e insertar el sucesor, con caducidad deslizante acotada por el máximo de la sesión.
      return this.insertSuccessor(session, {
        ...identity,
        parentHash: tokenHash,
        successorHash,
        now: decision.now,
        successorExpiresAt: decision.successorExpiresAt,
        reissued: false,
        reissueCount: 0,
      });
    });
  }

  /** Paso común de rotación y reemisión: recomprueba la sesión dentro de la transacción e inserta el token nuevo. */
  private async insertSuccessor(
    session: ClientSession,
    input: {
      readonly sessionId: string;
      readonly userId: string;
      readonly parentHash: string;
      readonly successorHash: string;
      readonly now: Date;
      readonly successorExpiresAt: Date;
      readonly reissued: boolean;
      readonly reissueCount: number;
    },
  ): Promise<RotationResult> {
    const current = await this.sessions
      .findById(input.sessionId)
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
          tokenHash: input.successorHash,
          sessionId: input.sessionId,
          userId: input.userId,
          createdAt: input.now,
          expiresAt: input.successorExpiresAt,
          rotatedAt: null,
          replacedByHash: null,
          parentHash: input.parentHash,
          advancedAt: null,
        },
      ],
      { session },
    );
    return {
      outcome: 'rotated',
      sessionId: input.sessionId,
      userId: input.userId,
      refreshExpiresAt: input.successorExpiresAt,
      reissued: input.reissued,
      reissueCount: input.reissueCount,
    };
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
    parentHash: document.parentHash ?? null,
    advancedAt: document.advancedAt ?? null,
    reissueCount: document.reissueCount ?? null,
  };
}
