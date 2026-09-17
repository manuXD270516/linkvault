import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import type {
  GroupLink,
  GroupLinkRepository,
  ShareInGroupInput,
  SharedGroupLink,
} from '../application/ports/group-link-repository.port';
import type {
  LinkListPage,
  LinkListQuery,
} from '../application/ports/link-listing';
import type { TransactionSession } from '../application/ports/transaction-session';
import { listLinkPage } from './link-page.query';
import {
  GROUP_LINK_MODEL_NAME,
  groupLinkSchema,
  toGroupObjectId,
  toLinkObjectId,
  toUserObjectId,
  type GroupLinkDocument,
} from './link.schemas';
import { modelOf } from './model-of';

// Adaptador Mongo de GROUP_LINK_REPOSITORY (D4 de job-links). Compartir es un `upsert` sobre el índice único
// `(groupId, linkId)`: compartir dos veces no duplica la relación ni cambia quién lo compartió primero, y por eso el
// alta va con `$setOnInsert`. Quitar borra **solo** la relación: el `JobLink` sigue disponible en los demás grupos y
// listas, porque nadie más puede haberlo perdido por una limpieza ajena.

@Injectable()
export class MongoGroupLinkRepository implements GroupLinkRepository {
  private readonly groupLinks: Model<GroupLinkDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.groupLinks = modelOf<GroupLinkDocument>(
      connection,
      GROUP_LINK_MODEL_NAME,
      groupLinkSchema,
    );
  }

  async share(
    input: ShareInGroupInput,
    session: TransactionSession,
  ): Promise<SharedGroupLink> {
    const groupId = toGroupObjectId(input.groupId);
    const linkId = toLinkObjectId(input.linkId);
    const sharedBy = toUserObjectId(input.sharedBy);
    if (groupId === null || linkId === null || sharedBy === null) {
      throw new Error('Sharing a link needs well formed group, link and user ids');
    }
    const result = await this.groupLinks
      .findOneAndUpdate(
        { groupId, linkId },
        { $setOnInsert: { groupId, linkId, sharedBy, sharedAt: input.sharedAt } },
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
      throw new Error('The group link upsert returned no document');
    }
    const metadata = result.lastErrorObject as
      | { updatedExisting?: boolean }
      | undefined;
    return {
      relation: toGroupLink(document.toObject()),
      created: metadata?.updatedExisting !== true,
    };
  }

  async find(groupId: string, linkId: string): Promise<GroupLink | null> {
    const ids = this.toRelationIds(groupId, linkId);
    if (ids === null) {
      return null;
    }
    const document = await this.groupLinks.findOne(ids).lean().exec();
    return document ? toGroupLink(document) : null;
  }

  async listByGroup(
    groupId: string,
    query: LinkListQuery,
  ): Promise<LinkListPage> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return { items: [] };
    }
    return await listLinkPage(
      this.groupLinks,
      { groupId: id },
      'sharedAt',
      query,
      true,
    );
  }

  async countByGroup(groupId: string): Promise<number> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return 0;
    }
    return await this.groupLinks.countDocuments({ groupId: id }).exec();
  }

  async groupsWithLink(
    groupIds: readonly string[],
    linkId: string,
  ): Promise<Set<string>> {
    const id = toLinkObjectId(linkId);
    const ids = groupIds
      .map((groupId) => toGroupObjectId(groupId))
      .filter((groupId): groupId is Types.ObjectId => groupId !== null);
    if (id === null || ids.length === 0) {
      return new Set();
    }
    // Una sola consulta para todos los grupos del usuario: es lo que evita el N+1 de `alreadyInGroups` (D4).
    const found = await this.groupLinks
      .distinct('groupId', { groupId: { $in: ids }, linkId: id })
      .exec();
    return new Set(found.map((groupId: Types.ObjectId) => groupId.toHexString()));
  }

  async remove(groupId: string, linkId: string): Promise<boolean> {
    const ids = this.toRelationIds(groupId, linkId);
    if (ids === null) {
      return false;
    }
    const result = await this.groupLinks.deleteOne(ids).exec();
    return result.deletedCount === 1;
  }

  async deleteByGroup(
    groupId: string,
    session: TransactionSession,
  ): Promise<number> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return 0;
    }
    const result = await this.groupLinks
      .deleteMany({ groupId: id })
      .session(session as ClientSession)
      .exec();
    return result.deletedCount;
  }

  async deleteByLink(linkId: string): Promise<number> {
    const id = toLinkObjectId(linkId);
    if (id === null) {
      return 0;
    }
    const result = await this.groupLinks.deleteMany({ linkId: id }).exec();
    return result.deletedCount;
  }

  /** `null` si alguno de los dos identificadores no tiene el formato esperado. */
  private toRelationIds(
    groupId: string,
    linkId: string,
  ): { groupId: Types.ObjectId; linkId: Types.ObjectId } | null {
    const group = toGroupObjectId(groupId);
    const link = toLinkObjectId(linkId);
    return group === null || link === null
      ? null
      : { groupId: group, linkId: link };
  }
}

function toGroupLink(document: GroupLinkDocument): GroupLink {
  return {
    groupId: document.groupId.toHexString(),
    linkId: document.linkId.toHexString(),
    sharedBy: document.sharedBy.toHexString(),
    sharedAt: document.sharedAt,
  };
}
