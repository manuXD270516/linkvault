import {
  AI_CONSENT_TEXT_VERSION,
  isAiConsentCurrent,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Schema,
  Types,
  type Connection,
  type Model,
  type Schema as MongooseSchema,
} from 'mongoose';
import type { SearchAiConsent } from '../application/ports/search-ai-consent.port';

// Vista mínima de `users` (mismo patrón que match/MongoAiContextReader): el worker no importa api/users.

const USER_MODEL_NAME = 'SearchWorkerUser';
const USERS_COLLECTION = 'users';
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

interface UserDocument {
  _id: Types.ObjectId;
  aiConsent: {
    externalProviders: boolean;
    textVersion: string | null;
  };
}

const userSchema = new Schema<UserDocument>(
  {
    aiConsent: {
      type: new Schema(
        {
          externalProviders: { type: Boolean, required: true },
          textVersion: { type: String, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
  },
  {
    collection: USERS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: false,
  },
);

const SAFE = { externalProviders: false as const };

@Injectable()
export class MongoSearchAiConsent implements SearchAiConsent {
  private readonly users: Model<UserDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.users = modelOf(connection, USER_MODEL_NAME, userSchema);
  }

  async of(userId: string): Promise<{ readonly externalProviders: boolean }> {
    if (!OBJECT_ID_HEX.test(userId)) {
      return SAFE;
    }
    const document = await this.users
      .findById(new Types.ObjectId(userId))
      .lean()
      .exec();
    if (document === null) {
      return SAFE;
    }
    return {
      externalProviders: isAiConsentCurrent({
        externalProviders: document.aiConsent.externalProviders,
        textVersion: document.aiConsent.textVersion,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      }),
    };
  }
}

function modelOf<T>(
  connection: Connection,
  name: string,
  schema: MongooseSchema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}
