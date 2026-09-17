import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import type {
  LinkListPage,
  LinkListQuery,
} from '../application/ports/link-listing';
import type { TransactionSession } from '../application/ports/transaction-session';
import type {
  SavedUserLink,
  SaveForUserInput,
  UserLink,
  UserLinkRepository,
} from '../application/ports/user-link-repository.port';
import { listLinkPage } from './link-page.query';
import {
  USER_LINK_MODEL_NAME,
  toLinkObjectId,
  toUserObjectId,
  userLinkSchema,
  type UserLinkDocument,
} from './link.schemas';
import { modelOf } from './model-of';

// Adaptador Mongo de USER_LINK_REPOSITORY (D1 de job-links): la lista privada, lo que alguien guarda **sin** grupo.
// Mismas operaciones y mismo upsert idempotente que la relación con un grupo, sobre el índice único `(userId, linkId)`.
// Guardar en un grupo NO escribe aquí: por eso, si el owner borra el grupo, quien solo lo guardó allí pierde el acceso
// (Risks de job-links).

@Injectable()
export class MongoUserLinkRepository implements UserLinkRepository {
  private readonly userLinks: Model<UserLinkDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.userLinks = modelOf<UserLinkDocument>(
      connection,
      USER_LINK_MODEL_NAME,
      userLinkSchema,
    );
  }

  async save(
    input: SaveForUserInput,
    session: TransactionSession,
  ): Promise<SavedUserLink> {
    const ids = this.toEntryIds(input.userId, input.linkId);
    if (ids === null) {
      throw new Error('Saving a link needs well formed user and link ids');
    }
    const result = await this.userLinks
      .findOneAndUpdate(
        ids,
        { $setOnInsert: { ...ids, savedAt: input.savedAt } },
        {
          upsert: true,
          returnDocument: 'after',
          includeResultMetadata: true,
          session: session as ClientSession,
        },
      )
      .exec();
    const document = result.value;
    if (document === null) {
      throw new Error('The user link upsert returned no document');
    }
    const metadata = result.lastErrorObject as
      | { updatedExisting?: boolean }
      | undefined;
    return {
      relation: toUserLink(document.toObject()),
      created: metadata?.updatedExisting !== true,
    };
  }

  async find(userId: string, linkId: string): Promise<UserLink | null> {
    const ids = this.toEntryIds(userId, linkId);
    if (ids === null) {
      return null;
    }
    const document = await this.userLinks.findOne(ids).lean().exec();
    return document ? toUserLink(document) : null;
  }

  async listByUser(userId: string, query: LinkListQuery): Promise<LinkListPage> {
    const id = toUserObjectId(userId);
    if (id === null) {
      return { items: [] };
    }
    return await listLinkPage(
      this.userLinks,
      { userId: id },
      'savedAt',
      query,
      false,
    );
  }

  async countByUser(userId: string): Promise<number> {
    const id = toUserObjectId(userId);
    if (id === null) {
      return 0;
    }
    return await this.userLinks.countDocuments({ userId: id }).exec();
  }

  async remove(userId: string, linkId: string): Promise<boolean> {
    const ids = this.toEntryIds(userId, linkId);
    if (ids === null) {
      return false;
    }
    const result = await this.userLinks.deleteOne(ids).exec();
    return result.deletedCount === 1;
  }

  async deleteByLink(linkId: string): Promise<number> {
    const id = toLinkObjectId(linkId);
    if (id === null) {
      return 0;
    }
    const result = await this.userLinks.deleteMany({ linkId: id }).exec();
    return result.deletedCount;
  }

  /** `null` si alguno de los dos identificadores no tiene el formato esperado. */
  private toEntryIds(
    userId: string,
    linkId: string,
  ): { userId: Types.ObjectId; linkId: Types.ObjectId } | null {
    const user = toUserObjectId(userId);
    const link = toLinkObjectId(linkId);
    return user === null || link === null ? null : { userId: user, linkId: link };
  }
}

function toUserLink(document: UserLinkDocument): UserLink {
  return {
    userId: document.userId.toHexString(),
    linkId: document.linkId.toHexString(),
    savedAt: document.savedAt,
  };
}
