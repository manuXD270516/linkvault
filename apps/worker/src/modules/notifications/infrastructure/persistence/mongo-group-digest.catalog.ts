import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import type {
  DigestGroupPage,
  DigestWindowLink,
  GroupDigestCatalog,
} from '../../application/ports/notify.ports';

const GROUPS = 'groups';
const GROUP_LINKS = 'group_links';
const LINKS = 'job_links';

function oid(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}

/**
 * Catálogo Mongo del digest: pagina grupos y lee group_links.sharedAt en ventana.
 * Proyección sin `note` (ADR-035 / group-weekly-digest).
 */
@Injectable()
export class MongoGroupDigestCatalog implements GroupDigestCatalog {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listGroupIds(params: {
    readonly afterId: string | null;
    readonly limit: number;
  }): Promise<DigestGroupPage> {
    const filter: Record<string, unknown> = {};
    if (params.afterId !== null) {
      const after = oid(params.afterId);
      if (after === null) {
        return { groupIds: [], nextCursor: null };
      }
      filter['_id'] = { $gt: after };
    }
    const docs = await this.connection
      .collection(GROUPS)
      .find(filter, { projection: { _id: 1 } })
      .sort({ _id: 1 })
      .limit(params.limit)
      .toArray();
    const groupIds = docs.map((d) => String(d._id));
    const last = groupIds[groupIds.length - 1];
    const nextCursor =
      groupIds.length === params.limit && last !== undefined ? last : null;
    return { groupIds, nextCursor };
  }

  async listLinksInWindow(params: {
    readonly groupId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
    readonly limit: number;
  }): Promise<readonly DigestWindowLink[]> {
    const groupId = oid(params.groupId);
    if (groupId === null) {
      return [];
    }
    const relations = await this.connection
      .collection(GROUP_LINKS)
      .find(
        {
          groupId,
          sharedAt: { $gte: params.windowStart, $lt: params.windowEnd },
        },
        {
          // Sin `note` / tags / pinned de grupo (ADR-035; D7 de group-link-tags-pinned): strip obligatorio del digest.
          projection: { linkId: 1, sharedAt: 1 },
        },
      )
      .sort({ sharedAt: -1 })
      .limit(params.limit)
      .toArray();

    if (relations.length === 0) {
      return [];
    }

    const linkOids = relations
      .map((r) => r['linkId'] as Types.ObjectId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    const titles = new Map<string, string | null>();
    if (linkOids.length > 0) {
      const linkDocs = await this.connection
        .collection(LINKS)
        .find(
          { _id: { $in: linkOids } },
          { projection: { 'preview.title': 1 } },
        )
        .toArray();
      for (const doc of linkDocs) {
        const title = doc['preview']?.['title'];
        titles.set(
          String(doc._id),
          typeof title === 'string' ? title : null,
        );
      }
    }

    return relations.map((r) => {
      const linkId = String(r['linkId']);
      return {
        linkId,
        sharedAt: r['sharedAt'] as Date,
        title: titles.get(linkId) ?? null,
      };
    });
  }

  async countLinksInWindow(params: {
    readonly groupId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
  }): Promise<number> {
    const groupId = oid(params.groupId);
    if (groupId === null) {
      return 0;
    }
    return await this.connection.collection(GROUP_LINKS).countDocuments({
      groupId,
      sharedAt: { $gte: params.windowStart, $lt: params.windowEnd },
    });
  }
}
