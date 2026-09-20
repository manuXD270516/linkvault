import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type {
  ClientSession,
  Connection,
  Model,
  PipelineStage,
  Types,
} from 'mongoose';
import type {
  GroupLinkComment,
  NewGroupLinkComment,
} from '../domain/group-link-comment';
import type {
  CommentListQuery,
  CommentPageSlice,
  GroupLinkCommentRepository,
} from '../application/ports/group-link-comment-repository.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import {
  GROUP_LINK_COMMENT_MODEL_NAME,
  groupLinkCommentSchema,
  toCommentObjectId,
  type GroupLinkCommentDocument,
} from './group-link-comment.schemas';
import {
  toGroupObjectId,
  toLinkObjectId,
  toUserObjectId,
} from './link.schemas';
import { modelOf } from './model-of';

// Adaptador Mongo de GROUP_LINK_COMMENT_REPOSITORY (D2 y D7 de group-comments). **No abre transacciones ni toca
// contadores**: las escrituras usan la sesión que le pasa `MongoGroupLinkRepository`, el dueño de la invariante "un
// comentario existe solo mientras su relación existe". Las lecturas van todas por el índice
// `{ groupId, linkId, createdAt: -1, _id: -1 }`.
//
// Nunca registra el texto de un comentario.

/** Cuántos comentarios lleva el resumen de la tarjeta. */
const LATEST_PER_LINK = 2;

@Injectable()
export class MongoGroupLinkCommentRepository
  implements GroupLinkCommentRepository
{
  private readonly comments: Model<GroupLinkCommentDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.comments = modelOf<GroupLinkCommentDocument>(
      connection,
      GROUP_LINK_COMMENT_MODEL_NAME,
      groupLinkCommentSchema,
    );
  }

  async insert(
    comment: NewGroupLinkComment,
    session: TransactionSession,
  ): Promise<GroupLinkComment> {
    const groupId = toGroupObjectId(comment.groupId);
    const linkId = toLinkObjectId(comment.linkId);
    const authorId = toUserObjectId(comment.authorId);
    if (groupId === null || linkId === null || authorId === null) {
      throw new Error('A comment needs well formed group, link and author ids');
    }
    const [created] = await this.comments.create(
      [
        {
          groupId,
          linkId,
          authorId,
          text: comment.text,
          createdAt: comment.createdAt,
        },
      ],
      { session: session as ClientSession },
    );
    if (created === undefined) {
      throw new Error('The comment insert returned no document');
    }
    return toComment(created.toObject());
  }

  async deleteOne(
    groupId: string,
    linkId: string,
    commentId: string,
    session: TransactionSession,
  ): Promise<boolean> {
    const filter = this.commentFilter(groupId, linkId, commentId);
    if (filter === null) {
      return false;
    }
    const result = await this.comments
      .deleteOne(filter)
      .session(session as ClientSession)
      .exec();
    return result.deletedCount === 1;
  }

  async deleteByRelation(
    groupId: string,
    linkId: string,
    session: TransactionSession,
  ): Promise<number> {
    const group = toGroupObjectId(groupId);
    const link = toLinkObjectId(linkId);
    if (group === null || link === null) {
      return 0;
    }
    const result = await this.comments
      .deleteMany({ groupId: group, linkId: link })
      .session(session as ClientSession)
      .exec();
    return result.deletedCount;
  }

  async deleteByGroup(
    groupId: string,
    session: TransactionSession,
  ): Promise<number> {
    const group = toGroupObjectId(groupId);
    if (group === null) {
      return 0;
    }
    const result = await this.comments
      .deleteMany({ groupId: group })
      .session(session as ClientSession)
      .exec();
    return result.deletedCount;
  }

  async find(
    groupId: string,
    linkId: string,
    commentId: string,
  ): Promise<GroupLinkComment | null> {
    const filter = this.commentFilter(groupId, linkId, commentId);
    if (filter === null) {
      return null;
    }
    const document = await this.comments.findOne(filter).lean().exec();
    return document ? toComment(document) : null;
  }

  async page(
    groupId: string,
    linkId: string,
    query: CommentListQuery,
  ): Promise<CommentPageSlice> {
    const group = toGroupObjectId(groupId);
    const link = toLinkObjectId(linkId);
    if (group === null || link === null) {
      return { items: [] };
    }
    // Se piden `limit + 1` para saber si hay siguiente página sin contar; el total sale de `commentCount`.
    const documents = await this.comments
      .find({ groupId: group, linkId: link, ...afterCursor(query) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean()
      .exec();
    const items = documents.slice(0, query.limit).map(toComment);
    const last = items[items.length - 1];
    return documents.length > items.length && last !== undefined
      ? { items, nextCursor: { date: last.createdAt, relationId: last.id } }
      : { items };
  }

  async latestByLinks(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Map<string, GroupLinkComment[]>> {
    const group = toGroupObjectId(groupId);
    const links = [...new Set(linkIds)]
      .map((linkId) => toLinkObjectId(linkId))
      .filter((linkId): linkId is Types.ObjectId => linkId !== null);
    const latest = new Map<string, GroupLinkComment[]>();
    if (group === null || links.length === 0) {
      return latest;
    }
    // Una sola agregación para la página entera, sea de 2 links o de 50: `$topN` (Mongo ≥ 5.2) se queda con los dos más
    // recientes de cada link sin una consulta por link (D7).
    const rows = await this.comments
      .aggregate<{
        _id: Types.ObjectId;
        latest: GroupLinkCommentDocument[];
      }>(latestPipeline(group, links))
      .exec();
    for (const row of rows) {
      latest.set(row._id.toHexString(), row.latest.map(toComment));
    }
    return latest;
  }

  /** Filtro de un comentario concreto de un link en un grupo; `null` si algún id está mal formado. */
  private commentFilter(
    groupId: string,
    linkId: string,
    commentId: string,
  ): {
    _id: Types.ObjectId;
    groupId: Types.ObjectId;
    linkId: Types.ObjectId;
  } | null {
    const id = toCommentObjectId(commentId);
    const group = toGroupObjectId(groupId);
    const link = toLinkObjectId(linkId);
    return id === null || group === null || link === null
      ? null
      : { _id: id, groupId: group, linkId: link };
  }
}

/** Agregación del resumen de la tarjeta, expuesta para que la integración compruebe su plan con `explain`. */
export function latestPipeline(
  groupId: Types.ObjectId,
  linkIds: readonly Types.ObjectId[],
): PipelineStage[] {
  return [
    { $match: { groupId, linkId: { $in: [...linkIds] } } },
    {
      $group: {
        _id: '$linkId',
        latest: {
          $topN: {
            n: LATEST_PER_LINK,
            sortBy: { createdAt: -1, _id: -1 },
            output: '$$ROOT',
          },
        },
      },
    },
  ];
}

/** Comentarios estrictamente detrás del cursor: primero por fecha y, a igualdad, por `_id`. */
function afterCursor(query: CommentListQuery): Record<string, unknown> {
  const cursor = query.cursor;
  const after =
    cursor === undefined ? null : toCommentObjectId(cursor.relationId);
  if (cursor === undefined || after === null) {
    return {};
  }
  return {
    $or: [
      { createdAt: { $lt: cursor.date } },
      { createdAt: cursor.date, _id: { $lt: after } },
    ],
  };
}

function toComment(document: GroupLinkCommentDocument): GroupLinkComment {
  return {
    id: document._id.toHexString(),
    groupId: document.groupId.toHexString(),
    linkId: document.linkId.toHexString(),
    authorId: document.authorId.toHexString(),
    text: document.text,
    createdAt: document.createdAt,
  };
}
