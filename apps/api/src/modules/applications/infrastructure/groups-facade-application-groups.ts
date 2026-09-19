import { Injectable } from '@nestjs/common';
import { GroupsFacade } from '../../groups/application/groups.facade';
import type { ApplicationGroups } from '../application/ports/application-groups.port';

/**
 * Adaptador APPLICATION_GROUPS sobre el `GroupsFacade` que exporta `GroupsModule` (D6 de applications-tracking): una sola
 * consulta de los miembros actuales. Un grupo borrado, inexistente o con el id mal formado no tiene miembros.
 */
@Injectable()
export class GroupsFacadeApplicationGroups implements ApplicationGroups {
  constructor(private readonly groups: GroupsFacade) {}

  memberIdsOf(groupId: string): Promise<string[]> {
    return this.groups.memberIdsOf(groupId);
  }
}
