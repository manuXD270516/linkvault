import { Injectable } from '@nestjs/common';
import { GroupsFacade } from '../../groups/application/groups.facade';
import type {
  GroupMembership,
  UserGroup,
} from '../application/ports/group-membership.port';
import type { GroupRole } from '@linkvault/shared';

/**
 * Adaptador GROUP_MEMBERSHIP sobre el `GroupsFacade` que exporta `GroupsModule` (D1 de job-links). `links` no lee las
 * colecciones de `groups` ni conoce más que la pertenencia, el rol y el nombre del grupo: el facade resuelve los grupos
 * del usuario en una sola consulta, sin membresías huérfanas, y un identificador mal formado responde `null` o una
 * lista vacía, que el caso de uso traduce en el 404 uniforme de `groups`.
 */
@Injectable()
export class GroupsFacadeMembership implements GroupMembership {
  constructor(private readonly groups: GroupsFacade) {}

  membershipOf(groupId: string, userId: string): Promise<GroupRole | null> {
    return this.groups.membershipOf(groupId, userId);
  }

  /**
   * Una consulta por grupo: un link suele estar en uno o dos, y el facade no ofrece una lectura conjunta. Si algún día
   * un link vive en decenas de grupos, esto es lo que hay que cambiar.
   */
  async memberIdsOf(groupIds: readonly string[]): Promise<string[]> {
    const members = new Set<string>();
    for (const groupId of groupIds) {
      for (const userId of await this.groups.memberIdsOf(groupId)) {
        members.add(userId);
      }
    }
    return [...members];
  }

  peersAmong(
    userId: string,
    candidateIds: readonly string[],
  ): Promise<Set<string>> {
    return this.groups.peersAmong(userId, candidateIds);
  }

  async groupsOf(userId: string): Promise<UserGroup[]> {
    const groups = await this.groups.getGroupsOf(userId);
    return groups.map((group) => ({
      groupId: group.groupId,
      name: group.name,
      role: group.role,
      defaultVisibility: group.defaultVisibility,
    }));
  }
}
