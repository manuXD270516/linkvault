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
        emailVerified: user.emailVerified,
        displayName: user.profile.displayName,
        aiConsent: {
          externalProviders: user.profile.aiConsent.externalProviders,
          consentedAt: user.profile.aiConsent.consentedAt,
          textVersion: user.profile.aiConsent.textVersion,
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

  /** Una sola consulta `$in` con proyección de `displayName`: ningún otro campo del perfil sale de `users` (D7 de
   * groups). Los ids mal formados se descartan antes de consultar, así que no llegan a `CastError`. */
  async findDisplayNames(ids: readonly string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids)].filter(isObjectIdHex);
    if (wanted.length === 0) {
      return new Map();
    }
    const documents = await this.model
      .find({ _id: { $in: wanted } }, { displayName: 1 })
      .lean<Pick<UserDocument, '_id' | 'displayName'>[]>()
      .exec();
    return new Map(
      documents.map((document) => [
        document._id.toHexString(),
        document.displayName,
      ]),
    );
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
    session?: object,
  ): Promise<boolean> {
    if (!isObjectIdHex(id)) {
      return false;
    }
    const result = await this.model
      .updateOne(
        { _id: id },
        { $set: { passwordHash, passwordChangedAt: changedAt } },
        session === undefined
          ? undefined
          : { session: session as import('mongoose').ClientSession },
      )
      .exec();
    return result.matchedCount === 1;
  }

  async markEmailVerified(id: string, session?: object): Promise<boolean> {
    if (!isObjectIdHex(id)) {
      return false;
    }
    const result = await this.model
      .updateOne(
        { _id: id },
        { $set: { emailVerified: true } },
        session === undefined
          ? undefined
          : { session: session as import('mongoose').ClientSession },
      )
      .exec();
    return result.matchedCount === 1;
  }

  async delete(id: string, session?: object): Promise<boolean> {
    if (!isObjectIdHex(id)) {
      return false;
    }
    const result = await this.model
      .deleteOne(
        { _id: id },
        session === undefined
          ? undefined
          : { session: session as import('mongoose').ClientSession },
      )
      .exec();
    return result.deletedCount === 1;
  }
}

/** `$set` solo de los campos presentes: una actualización parcial nunca pisa los demás. */
function toProfileUpdate(changes: ProfileChanges): UpdateQuery<UserDocument> {
  const set: Record<string, string | boolean | Date | null> = {};
  if (changes.displayName !== undefined) {
    set['displayName'] = changes.displayName;
  }
  if (changes.aiConsent !== undefined) {
    set['aiConsent.externalProviders'] = changes.aiConsent.externalProviders;
    set['aiConsent.consentedAt'] = changes.aiConsent.consentedAt;
    set['aiConsent.textVersion'] = changes.aiConsent.textVersion;
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
    // Cuentas previas sin el campo → verificadas (ADR-034 D7).
    emailVerified: document.emailVerified ?? true,
    profile: {
      displayName: document.displayName,
      aiConsent: {
        externalProviders: document.aiConsent.externalProviders,
        consentedAt: document.aiConsent.consentedAt ?? null,
        textVersion: document.aiConsent.textVersion ?? null,
      },
      outputLanguage: document.outputLanguage,
      redactName: document.redactName,
    },
    createdAt: document.createdAt,
  };
}
