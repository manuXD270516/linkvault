import {
  AI_CONSENT_TEXT_VERSION,
  isAiConsentCurrent,
  type OutputLanguage,
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
import type {
  AiContextReader,
  MatchAiContext,
} from '../../application/ports/ai-context-reader.port';

// Lectura del consentimiento efectivo desde `users` (tarea 13.3). El worker no importa el módulo `users` de `api`:
// declara la vista mínima de la colección y aplica `isAiConsentCurrent` de `@linkvault/shared`.

const USER_MODEL_NAME = 'MatchWorkerUser';
const USERS_COLLECTION = 'users';
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

interface UserDocument {
  _id: Types.ObjectId;
  displayName: string;
  aiConsent: {
    externalProviders: boolean;
    textVersion: string | null;
  };
  outputLanguage: OutputLanguage;
  redactName: boolean;
}

const userSchema = new Schema<UserDocument>(
  {
    displayName: { type: String, required: true },
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
    outputLanguage: { type: String, required: true },
    redactName: { type: Boolean, required: true },
  },
  {
    collection: USERS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: false,
  },
);

const SAFE_DEFAULT: MatchAiContext = {
  aiConsent: { externalProviders: false },
  outputLanguage: 'es',
  redactName: true,
  personName: '',
};

@Injectable()
export class MongoAiContextReader implements AiContextReader {
  private readonly users: Model<UserDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.users = modelOf(connection, USER_MODEL_NAME, userSchema);
  }

  async read(userId: string): Promise<MatchAiContext> {
    if (!OBJECT_ID_HEX.test(userId)) {
      return SAFE_DEFAULT;
    }
    const document = await this.users
      .findById(new Types.ObjectId(userId))
      .lean()
      .exec();
    if (document === null) {
      return SAFE_DEFAULT;
    }
    return {
      aiConsent: {
        externalProviders: isAiConsentCurrent({
          externalProviders: document.aiConsent.externalProviders,
          textVersion: document.aiConsent.textVersion,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        }),
      },
      outputLanguage: document.outputLanguage === 'en' ? 'en' : 'es',
      redactName: document.redactName,
      personName: document.displayName,
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
