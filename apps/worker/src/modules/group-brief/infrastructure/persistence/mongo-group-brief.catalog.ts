import { jobSkillSchema } from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import type {
  GroupBriefCatalog,
  GroupBriefGroupPage,
  StoredGroupBriefs,
} from '../../application/ports/group-brief.ports';
import type { UniverseOffer } from '../../domain/group-brief-universe';
import { GROUP_WEEKLY_BRIEFS_COLLECTION } from './group-weekly-brief.document';

const GROUPS = 'groups';
const GROUP_LINKS = 'group_links';
const LINKS = 'job_links';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oid(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}

function isoInstant(value: unknown): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : null;
}

/** `expiresAt` es un día: llega como `YYYY-MM-DD` (o como `Date` si alguien lo guardó así). */
function isoDay(value: unknown): string | null {
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    return value;
  }
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : null;
}

/** Habilidades que validan con `jobSkillSchema`; las demás se ignoran sin error (H10). */
function validSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of value) {
    const parsed = jobSkillSchema.safeParse(entry);
    if (parsed.success) {
      names.push(parsed.data.name);
    }
  }
  return names;
}

/**
 * Catálogo Mongo del brief (design D2, D3, D4): solo lee datos de las ofertas. `group_links` con proyección
 * `linkId, sharedAt` (nunca nota, etiquetas, fijado ni quién la compartió) y `job_links` con `closedAt`,
 * `preview.expiresAt` y `preview.skills`: dos lecturas por grupo, sea cual sea el número de ofertas.
 */
@Injectable()
export class MongoGroupBriefCatalog implements GroupBriefCatalog {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listGroupIds(
    afterId: string | null,
    limit: number,
  ): Promise<GroupBriefGroupPage> {
    const filter: Record<string, unknown> = {};
    if (afterId !== null) {
      const after = oid(afterId);
      if (after === null) {
        return { groupIds: [], nextCursor: null };
      }
      filter['_id'] = { $gt: after };
    }
    const docs = await this.connection
      .collection(GROUPS)
      .find(filter, { projection: { _id: 1 } })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    const groupIds = docs.map((d) => String(d._id));
    const last = groupIds[groupIds.length - 1];
    return {
      groupIds,
      nextCursor: groupIds.length === limit && last !== undefined ? last : null,
    };
  }

  async currentBriefsOf(
    groupIds: readonly string[],
    weekKey: string,
  ): Promise<StoredGroupBriefs> {
    const ids = groupIds
      .map(oid)
      .filter((id): id is Types.ObjectId => id !== null);
    const found = new Map<string, Readonly<Record<string, unknown>>>();
    if (ids.length === 0) {
      return found;
    }
    const docs = await this.connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .find({ groupId: { $in: ids }, weekKey })
      .toArray();
    for (const doc of docs) {
      found.set(String(doc['groupId']), doc);
    }
    return found;
  }

  async scanGroupOffers(
    groupId: string,
    limit: number,
  ): Promise<readonly UniverseOffer[]> {
    const group = oid(groupId);
    if (group === null) {
      return [];
    }
    const relations = await this.connection
      .collection(GROUP_LINKS)
      .find(
        { groupId: group },
        { projection: { _id: 0, linkId: 1, sharedAt: 1 } },
      )
      .sort({ sharedAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    if (relations.length === 0) {
      return [];
    }

    const linkIds = relations
      .map((r) => r['linkId'])
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    const links = await this.connection
      .collection(LINKS)
      .find(
        { _id: { $in: linkIds } },
        {
          projection: {
            closedAt: 1,
            'preview.expiresAt': 1,
            'preview.skills': 1,
          },
        },
      )
      .toArray();
    const byId = new Map(links.map((l) => [String(l._id), l]));

    const offers: UniverseOffer[] = [];
    for (const relation of relations) {
      const id = String(relation['linkId']);
      const link = byId.get(id);
      const sharedAt = isoInstant(relation['sharedAt']);
      if (link === undefined || sharedAt === null) {
        continue;
      }
      const preview = link['preview'] as Record<string, unknown> | undefined;
      offers.push({
        id,
        sharedAt,
        closedAt: isoInstant(link['closedAt']),
        expiresAt: isoDay(preview?.['expiresAt']),
        skills: validSkillNames(preview?.['skills']),
      });
    }
    return offers;
  }
}
