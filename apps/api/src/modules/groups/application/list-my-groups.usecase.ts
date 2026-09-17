import type { GroupSummary } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { toGroupSummary } from './group.mapper';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `GET /api/groups` (spec groups/group-management): los grupos del usuario con su rol, por `joinedAt` descendente y sin
 * el código de invitación. Una membresía cuyo grupo ya no existe no aparece (D6). El número de miembros de todos los
 * grupos se resuelve con una sola agregación, no con una consulta por grupo (D1).
 */
@Injectable()
export class ListMyGroups {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
  ) {}

  async execute(userId: string): Promise<GroupSummary[]> {
    const memberships = await this.groups.listGroupsOfUser(userId);
    const counts = await this.groups.countMembers(
      memberships.map((membership) => membership.group.id),
    );
    return memberships.map((membership) =>
      toGroupSummary(
        membership.group,
        membership.role,
        counts.get(membership.group.id) ?? 0,
        membership.joinedAt,
      ),
    );
  }
}
