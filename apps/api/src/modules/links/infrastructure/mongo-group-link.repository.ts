import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import type { NewGroupLinkComment } from '../domain/group-link-comment';
import {
  GROUP_LINK_COMMENT_REPOSITORY,
  type GroupLinkCommentRepository,
} from '../application/ports/group-link-comment-repository.port';
import type {
  AddedComment,
  CommentsCounters,
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
// `(groupId, linkId)`: compartir dos veces no duplica la relación ni cambia quién lo compartió primero ni su nota, y por
// eso el alta va con `$setOnInsert`. Quitar borra la relación y sus comentarios, **nunca** el `JobLink`, que sigue
// disponible en los demás grupos y listas.
//
// Es el **único dueño** de `commentCount` y `commentsRevision`, y el único que abre transacciones que tocan comentarios
// (D2 de group-comments, ADR-026 §2). El repositorio de comentarios escribe con la sesión que recibe de aquí.
//
// **Por qué el `$inc` cierra la carrera.** El alta de un comentario y la retirada del link escriben el **mismo
// documento** de relación: Mongo aborta una de las dos transacciones con `WriteConflict` y `withTransaction` la reintenta
// viendo el estado final. Si el alta confirma primero, la retirada borra también su comentario; si la retirada confirma
// primero, el reintento del alta no encuentra la relación y devuelve `null` sin guardar nada. Nunca queda un comentario
// sin relación que reaparezca al volver a compartir.

/** Filtro de una relación concreta. */
interface RelationFilter {
  groupId: Types.ObjectId;
  linkId: Types.ObjectId;
}

@Injectable()
export class MongoGroupLinkRepository implements GroupLinkRepository {
  private readonly groupLinks: Model<GroupLinkDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(GROUP_LINK_COMMENT_REPOSITORY)
    private readonly comments: GroupLinkCommentRepository,
  ) {
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
        {
          // La nota va con el alta y solo con ella: si la relación ya estaba, la del primero no cambia (D3).
          $setOnInsert: {
            groupId,
            linkId,
            sharedBy,
            sharedAt: input.sharedAt,
            ...(input.note === undefined
              ? {}
              : {
                  note: {
                    text: input.note.text,
                    createdAt: input.note.createdAt,
                  },
                }),
            commentCount: 0,
            commentsRevision: 0,
          },
        },
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
    const ids = toRelationFilter(groupId, linkId);
    if (ids === null) {
      return null;
    }
    const document = await this.groupLinks.findOne(ids).lean().exec();
    return document ? toGroupLink(document) : null;
  }

  async relationsOfLink(linkId: string): Promise<GroupLink[]> {
    const id = toLinkObjectId(linkId);
    if (id === null) {
      return [];
    }
    // Una sola consulta por el índice `{ linkId: 1 }`: sin él, cada aviso de una importación de 50 links sería un
    // escaneo completo de la colección (D9).
    const documents = await this.groupLinks.find({ linkId: id }).lean().exec();
    return documents.map(toGroupLink);
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

  async linkIdsIn(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Set<string>> {
    const group = toGroupObjectId(groupId);
    const ids = [...new Set(linkIds)]
      .map((linkId) => toLinkObjectId(linkId))
      .filter((linkId): linkId is Types.ObjectId => linkId !== null);
    if (group === null || ids.length === 0) {
      return new Set();
    }
    // Una sola consulta por el índice único `(groupId, linkId)`, pida 2 links o 50 (D6 de applications-tracking).
    const found = await this.groupLinks
      .distinct('linkId', { groupId: group, linkId: { $in: ids } })
      .exec();
    return new Set(found.map((linkId: Types.ObjectId) => linkId.toHexString()));
  }

  async removeWithComments(groupId: string, linkId: string): Promise<boolean> {
    const ids = toRelationFilter(groupId, linkId);
    if (ids === null) {
      return false;
    }
    return await this.withTransaction(async (session) => {
      const result = await this.groupLinks
        .deleteOne(ids)
        .session(session)
        .exec();
      if (result.deletedCount !== 1) {
        return false;
      }
      await this.comments.deleteByRelation(groupId, linkId, session);
      return true;
    });
  }

  async deleteByGroup(
    groupId: string,
    session: TransactionSession,
  ): Promise<number> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return 0;
    }
    // Primero los comentarios, con la misma sesión de `groups`: si fallan, no se borra nada (D8).
    await this.comments.deleteByGroup(groupId, session);
    const result = await this.groupLinks
      .deleteMany({ groupId: id })
      .session(session as ClientSession)
      .exec();
    return result.deletedCount;
  }

  async addComment(comment: NewGroupLinkComment): Promise<AddedComment | null> {
    const ids = toRelationFilter(comment.groupId, comment.linkId);
    if (ids === null) {
      return null;
    }
    return await this.withTransaction(async (session) => {
      const relation = await this.groupLinks
        .findOneAndUpdate(
          ids,
          { $inc: { commentCount: 1, commentsRevision: 1 } },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (relation === null) {
        // La relación ya no existe: no se guarda nada y el caso de uso responde `link_not_found`.
        return null;
      }
      await this.beforeCommentInsert();
      const stored = await this.comments.insert(comment, session);
      return { comment: stored, counters: countersOf(relation) };
    });
  }

  async removeComment(
    groupId: string,
    linkId: string,
    commentId: string,
  ): Promise<CommentsCounters | null> {
    const ids = toRelationFilter(groupId, linkId);
    if (ids === null) {
      return null;
    }
    return await this.withTransaction(async (session) => {
      if (!(await this.comments.deleteOne(groupId, linkId, commentId, session))) {
        // Otro borrado se adelantó, o nunca existió: no se toca el contador ni la revisión.
        return null;
      }
      const relation = await this.groupLinks
        .findOneAndUpdate(
          ids,
          { $inc: { commentCount: -1, commentsRevision: 1 } },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      return relation === null ? null : countersOf(relation);
    });
  }

  async clearNote(groupId: string, linkId: string): Promise<boolean> {
    const ids = toRelationFilter(groupId, linkId);
    if (ids === null) {
      return false;
    }
    const result = await this.groupLinks
      .updateOne(ids, { $unset: { note: 1 } })
      .exec();
    return result.matchedCount === 1;
  }

  /**
   * Punto de espera **solo para tests** entre el `$inc` y el `insert` del alta de un comentario (D2, tareas 2.10 y
   * 2.11). En producción no hace nada; un test lo sobrescribe para detener el alta a mitad de su transacción y provocar
   * cada orden de la carrera con la retirada del link.
   */
  protected async beforeCommentInsert(): Promise<void> {
    // Vacío a propósito.
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

/** `null` si alguno de los dos identificadores no tiene el formato esperado. */
function toRelationFilter(
  groupId: string,
  linkId: string,
): RelationFilter | null {
  const group = toGroupObjectId(groupId);
  const link = toLinkObjectId(linkId);
  return group === null || link === null
    ? null
    : { groupId: group, linkId: link };
}

function toGroupLink(document: GroupLinkDocument): GroupLink {
  return {
    groupId: document.groupId.toHexString(),
    linkId: document.linkId.toHexString(),
    sharedBy: document.sharedBy.toHexString(),
    sharedAt: document.sharedAt,
    ...(document.note === undefined || document.note === null
      ? {}
      : {
          note: { text: document.note.text, createdAt: document.note.createdAt },
        }),
    // Un documento anterior a group-comments no tiene los contadores: se leen como 0.
    commentCount: document.commentCount ?? 0,
    commentsRevision: document.commentsRevision ?? 0,
  };
}

function countersOf(document: GroupLinkDocument): CommentsCounters {
  return {
    count: document.commentCount ?? 0,
    revision: document.commentsRevision ?? 0,
    sharedAt: document.sharedAt,
  };
}
