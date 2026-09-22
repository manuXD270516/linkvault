import type { ClientSession, Connection, Model, Schema } from 'mongoose';
import type {
  EmailTokenConsumeEffect,
  EmailTokenPurpose,
  EmailTokenRepository,
  IssueEmailToken,
  IssuedEmailToken,
  ValidEmailToken,
} from '../application/ports/email-token-repository.port';
import type { Clock } from '../domain/clock';
import {
  AUTH_EMAIL_TOKEN_MODEL_NAME,
  authEmailTokenSchema,
  type AuthEmailTokenDocument,
} from './email-token.schemas';

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
 * Adaptador Mongo de `auth_email_tokens` (ADR-034 D3/D14): solo hash, invalidación de previos al emitir,
 * consumo + efecto de negocio en una txn.
 */
export class MongoEmailTokenRepository implements EmailTokenRepository {
  private readonly model: Model<AuthEmailTokenDocument>;

  constructor(
    private readonly connection: Connection,
    private readonly clock: Clock,
  ) {
    this.model = modelOf(
      connection,
      AUTH_EMAIL_TOKEN_MODEL_NAME,
      authEmailTokenSchema,
    );
  }

  async issue(input: IssueEmailToken): Promise<IssuedEmailToken> {
    const createdAt = this.clock.now();
    let issued!: IssuedEmailToken;
    await this.withTransaction(async (session) => {
      await this.model
        .updateMany(
          {
            userId: input.userId,
            purpose: input.purpose,
            usedAt: null,
          },
          { $set: { usedAt: createdAt } },
          { session },
        )
        .exec();
      const [created] = await this.model.create(
        [
          {
            tokenHash: input.tokenHash,
            userId: input.userId,
            purpose: input.purpose,
            expiresAt: input.expiresAt,
            usedAt: null,
            createdAt,
          },
        ],
        { session },
      );
      if (!created) {
        throw new Error('Failed to create email token');
      }
      issued = {
        id: created._id.toHexString(),
        userId: input.userId,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
        createdAt,
      };
    });
    return issued;
  }

  async findValid(
    tokenHash: string,
    purpose: EmailTokenPurpose,
    now: Date,
  ): Promise<ValidEmailToken | null> {
    const token = await this.model.findOne({ tokenHash, purpose }).lean().exec();
    if (
      !token ||
      token.usedAt !== null ||
      token.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    return {
      userId: token.userId,
      purpose: token.purpose,
      expiresAt: token.expiresAt,
    };
  }

  async consume(
    tokenHash: string,
    purpose: EmailTokenPurpose,
    now: Date,
    effect: EmailTokenConsumeEffect,
  ): Promise<'consumed' | 'invalid'> {
    return this.withTransaction(async (session) => {
      const token = await this.model
        .findOne({ tokenHash, purpose })
        .session(session)
        .exec();
      if (
        !token ||
        token.usedAt !== null ||
        token.expiresAt.getTime() <= now.getTime()
      ) {
        return 'invalid';
      }
      await effect(token.userId, session);
      token.usedAt = now;
      await token.save({ session });
      return 'consumed';
    });
  }

  async deleteAllForUser(
    userId: string,
    session?: object,
  ): Promise<number> {
    const result = await this.model
      .deleteMany(
        { userId },
        session === undefined
          ? undefined
          : { session: session as ClientSession },
      )
      .exec();
    return result.deletedCount;
  }

  private async withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}
