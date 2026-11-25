import type {
  GroupBriefBullet,
  GroupBriefFact,
  GroupWeeklyBrief,
} from '@linkvault/shared';
import { Types } from 'mongoose';

export const GROUP_WEEKLY_BRIEFS_COLLECTION = 'group_weekly_briefs';

/**
 * Documento de `group_weekly_briefs` (design D7, H1): tipo de infraestructura, no del contrato. `groupId` es un
 * `ObjectId`, `computedAt` un `Date` BSON y los `linkIds` de los hechos siguen siendo strings de 24 hexadecimales.
 * No lleva `_id`: lo asigna Mongo en el primer `upsert` y `replaceOne` lo conserva (N3).
 */
export interface GroupWeeklyBriefDocument {
  groupId: Types.ObjectId;
  weekKey: string;
  asOf: string;
  computedAt: Date;
  version: 1;
  scanTruncated: boolean;
  facts: GroupBriefFact[];
  bullets: GroupBriefBullet[];
}

/** Del contrato al documento. El orden de las claves es fijo: de él depende la comparación canónica (N4). */
export function toDocument(brief: GroupWeeklyBrief): GroupWeeklyBriefDocument {
  return {
    groupId: new Types.ObjectId(brief.groupId),
    weekKey: brief.weekKey,
    asOf: brief.asOf,
    computedAt: new Date(brief.computedAt),
    version: brief.version,
    scanTruncated: brief.scanTruncated,
    facts: brief.facts.map((fact) => ({ ...fact })),
    bullets: brief.bullets.map((bullet) => ({ ...bullet })),
  };
}
