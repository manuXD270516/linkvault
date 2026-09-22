import type { AiVendor } from '@linkvault/shared';
import type { ClientSession, Connection, Model } from 'mongoose';
import type {
  UpsertUserAiKeyInput,
  UserAiKeyRecord,
  UserAiKeysWriteSession,
  UserAiKeyView,
  UserAiKeysRepository,
} from '../../domain/ports/user-ai-keys.repository.port';
import {
  USER_AI_KEY_MODEL_NAME,
  userAiKeySchema,
  type UserAiKeyDocument,
} from './user-ai-key.schema';

// Repositorio Mongo de `user_ai_keys` (ADR-032 D1, D5). Vive en `libs/ai` para api y worker.

export class MongoUserAiKeysRepository implements UserAiKeysRepository {
  private readonly model: Model<UserAiKeyDocument>;

  constructor(connection: Connection) {
    this.model =
      (connection.models[USER_AI_KEY_MODEL_NAME] as
        | Model<UserAiKeyDocument>
        | undefined) ??
      connection.model<UserAiKeyDocument>(
        USER_AI_KEY_MODEL_NAME,
        userAiKeySchema,
      );
  }

  async upsert(input: UpsertUserAiKeyInput): Promise<UserAiKeyView> {
    const updatedAt = input.updatedAt ?? new Date();
    const document = await this.model
      .findOneAndUpdate(
        { userId: input.userId, vendor: input.vendor },
        {
          $set: {
            ciphertext: Buffer.from(input.ciphertext),
            keyHint: input.keyHint,
            updatedAt,
          },
          $setOnInsert: {
            userId: input.userId,
            vendor: input.vendor,
          },
        },
        { upsert: true, new: true, lean: true },
      )
      .exec();
    if (document === null) {
      throw new Error('user_ai_keys upsert returned null');
    }
    return toView(document);
  }

  async listByUser(userId: string): Promise<UserAiKeyView[]> {
    const documents = await this.model
      .find({ userId })
      .select({ vendor: 1, keyHint: 1, updatedAt: 1 })
      .sort({ vendor: 1 })
      .lean()
      .exec();
    return documents.map(toView);
  }

  async listRecordsByUser(userId: string): Promise<UserAiKeyRecord[]> {
    const documents = await this.model
      .find({ userId })
      .sort({ vendor: 1 })
      .lean()
      .exec();
    return documents.map(toRecord);
  }

  async findRecord(
    userId: string,
    vendor: AiVendor,
  ): Promise<UserAiKeyRecord | null> {
    const document = await this.model
      .findOne({ userId, vendor })
      .lean()
      .exec();
    return document === null ? null : toRecord(document);
  }

  async delete(userId: string, vendor: AiVendor): Promise<boolean> {
    const result = await this.model.deleteOne({ userId, vendor }).exec();
    return result.deletedCount > 0;
  }

  async deleteAllKeysForUser(
    userId: string,
    session?: UserAiKeysWriteSession,
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
}

function toView(
  document: Pick<UserAiKeyDocument, 'vendor' | 'keyHint' | 'updatedAt'>,
): UserAiKeyView {
  return {
    vendor: document.vendor,
    keyHint: document.keyHint,
    updatedAt: document.updatedAt,
  };
}

function toRecord(document: UserAiKeyDocument): UserAiKeyRecord {
  return {
    userId: document.userId,
    vendor: document.vendor,
    keyHint: document.keyHint,
    updatedAt: document.updatedAt,
    ciphertext: Uint8Array.from(document.ciphertext),
  };
}
