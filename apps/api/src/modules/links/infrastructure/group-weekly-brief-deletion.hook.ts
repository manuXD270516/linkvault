import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection } from 'mongoose';
import { GROUP_WEEKLY_BRIEFS_COLLECTION } from './mongo-group-weekly-brief.reader';

/**
 * Limpieza de «La semana del grupo» cuando se borra un grupo (design D11, H9). La colección es del worker, pero el
 * borrado del grupo es de la api: este hook borra los documentos `{ groupId }` en la misma transacción, así que si
 * algo falla se deshace todo el borrado y no quedan semanas huérfanas con ofertas de un grupo que ya no existe.
 */
@Injectable()
export class GroupWeeklyBriefDeletionHook {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async deleteRelationsOf(groupId: string, session: object): Promise<void> {
    if (!/^[0-9a-f]{24}$/i.test(groupId)) {
      return;
    }
    await this.connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .deleteMany(
        { groupId: new Types.ObjectId(groupId) },
        { session: session as ClientSession },
      );
  }
}
