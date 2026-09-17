import type { GroupDetail } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { resolveGroupAccess } from './group-access';
import { toGroupDetail } from './group.mapper';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `GET /api/groups/:id` (spec groups/group-management): detalle del grupo para cualquiera de sus miembros. El código de
 * invitación solo viaja si el rol resuelto es `owner`, y de eso se encarga el mapeo (D2). Un grupo ajeno, uno
 * inexistente y un identificador mal formado dan la misma respuesta.
 */
@Injectable()
export class GetGroup {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
  ) {}

  async execute(userId: string, groupId: string): Promise<GroupDetail> {
    const { group, membership } = await resolveGroupAccess(
      this.groups,
      groupId,
      userId,
    );
    const counts = await this.groups.countMembers([group.id]);
    return toGroupDetail(group, membership.role, counts.get(group.id) ?? 0, {
      includeInviteCode: true,
    });
  }
}
