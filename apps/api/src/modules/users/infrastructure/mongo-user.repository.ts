import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection, type Model, type UpdateQuery } from 'mongoose';
import type { UserRepository } from '../application/ports/user-repository.port';
import { EmailAlreadyRegistered } from '../domain/errors';
import type { NewUser, User } from '../domain/user';
import type { ProfileChanges } from '../domain/user-profile';
import { USER_MODEL_NAME, userSchema, type UserDocument } from './user.schema';

// Adaptador Mongo de USER_REPOSITORY (D1 de auth-users) sobre la conexión Mongoose de la app (`getConnectionToken()`).
// El perfil se guarda plano en el documento; el dominio lo recibe agrupado en `profile`.

const DUPLICATE_KEY = 11_000;

/** Los ids que emite este repositorio son ObjectId en hex; cualquier otra forma (incluidas cadenas de 12 bytes, que
 * `isValidObjectId` acepta) no identifica a ningún usuario. */
function isObjectIdHex(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

@Injectable()
export class MongoUserRepository implements UserRepository {
  private readonly model: Model<UserDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.model =
      (connection.models[USER_MODEL_NAME] as Model<UserDocument> | undefined) ??
      connection.model<UserDocument>(USER_MODEL_NAME, userSchema);
  }

  async create(user: NewUser): Promise<User> {
    try {
      const created = await this.model.create({
        email: user.email,
        passwordHash: user.passwordHash,
        passwordChangedAt: user.passwordChangedAt,
        displayName: user.profile.displayName,
        aiConsent: {
          externalProviders: user.profile.aiConsent.externalProviders,
        },
        outputLanguage: user.profile.outputLanguage,
        redactName: user.profile.redactName,
        createdAt: user.createdAt,
      });
      return toUser(created.toObject());
    } catch (error) {
      // El error del driver incluye el valor duplicado (el email): no se propaga.
      if (
        error instanceof mongo.MongoServerError &&
        error.code === DUPLICATE_KEY
      ) {
        throw new EmailAlreadyRegistered();
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    const document = await this.model.findOne({ email }).lean().exec();
    return document ? toUser(document) : null;
  }

  async findById(id: string): Promise<User | null> {
    if (!isObjectIdHex(id)) {
      return null;
    }
    const document = await this.model.findById(id).lean().exec();
    return document ? toUser(document) : null;
  }

  async updateProfile(
    id: string,
    changes: ProfileChanges,
  ): Promise<User | null> {
    if (!isObjectIdHex(id)) {
      return null;
    }
    const document = await this.model
      .findByIdAndUpdate(id, toProfileUpdate(changes), {
        returnDocument: 'after',
        runValidators: true,
      })
      .lean()
      .exec();
    return document ? toUser(document) : null;
  }

  async setPasswordHash(
    id: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<boolean> {
    if (!isObjectIdHex(id)) {
      return false;
    }
    const result = await this.model
      .updateOne(
        { _id: id },
        { $set: { passwordHash, passwordChangedAt: changedAt } },
      )
      .exec();
    return result.matchedCount === 1;
  }
}

/** `$set` solo de los campos presentes: una actualización parcial nunca pisa los demás. */
function toProfileUpdate(changes: ProfileChanges): UpdateQuery<UserDocument> {
  const set: Record<string, string | boolean> = {};
  if (changes.displayName !== undefined) {
    set['displayName'] = changes.displayName;
  }
  if (changes.aiConsent !== undefined) {
    set['aiConsent.externalProviders'] = changes.aiConsent.externalProviders;
  }
  if (changes.outputLanguage !== undefined) {
    set['outputLanguage'] = changes.outputLanguage;
  }
  if (changes.redactName !== undefined) {
    set['redactName'] = changes.redactName;
  }
  return { $set: set };
}

function toUser(document: UserDocument): User {
  return {
    id: document._id.toHexString(),
    email: document.email,
    passwordHash: document.passwordHash,
    passwordChangedAt: document.passwordChangedAt,
    profile: {
      displayName: document.displayName,
      aiConsent: { externalProviders: document.aiConsent.externalProviders },
      outputLanguage: document.outputLanguage,
      redactName: document.redactName,
    },
    createdAt: document.createdAt,
  };
}
