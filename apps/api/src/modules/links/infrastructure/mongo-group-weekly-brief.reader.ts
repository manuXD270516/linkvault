import { groupWeeklyBriefSchema } from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import type {
  CurrentGroupBrief,
  GroupWeeklyBriefReader,
} from '../application/ports/group-weekly-brief-reader.port';

export const GROUP_WEEKLY_BRIEFS_COLLECTION = 'group_weekly_briefs';

/**
 * Del documento de Mongo al contrato (design D7, H1): `groupId` pasa de `ObjectId` a su hexadecimal, `computedAt` de
 * `Date` a ISO y se descarta `_id`. No valida: eso lo hace zod después.
 */
export function fromDocument(
  document: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const { _id, groupId, computedAt, ...rest } = document;
  void _id;
  return {
    ...rest,
    groupId:
      groupId instanceof Types.ObjectId ? groupId.toHexString() : groupId,
    computedAt:
      computedAt instanceof Date ? computedAt.toISOString() : computedAt,
  };
}

/**
 * Lector Mongo de `group_weekly_briefs`: la colección es del worker, que declara sus índices; la api la lee cruda,
 * sin modelo ni `autoIndex`. Un `groupId` mal formado responde `null` sin consultar.
 */
@Injectable()
export class MongoGroupWeeklyBriefReader implements GroupWeeklyBriefReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findCurrent(
    groupId: string,
    weekKey: string,
  ): Promise<CurrentGroupBrief> {
    if (!/^[0-9a-f]{24}$/i.test(groupId)) {
      return null;
    }
    const document = await this.connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .findOne({ groupId: new Types.ObjectId(groupId), weekKey });
    if (document === null) {
      return null;
    }
    const parsed = groupWeeklyBriefSchema.safeParse(fromDocument(document));
    return parsed.success ? parsed.data : 'invalid';
  }
}
