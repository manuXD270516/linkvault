import type { GroupDetail } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  GroupNotFound,
  InvalidGroupName,
  OwnerRoleRequired,
} from '../domain/errors';
import { isValidGroupName, normalizeGroupName } from '../domain/group';
import { canRenameGroup } from '../domain/membership';
import { resolveGroupAccess } from './group-access';
import { toGroupDetail } from './group.mapper';
import { GROUPS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `PATCH /api/groups/:id` (spec groups/group-management): solo el owner renombra. El rol se comprueba antes que el
 * nombre, para que un miembro reciba `forbidden` y no una pista sobre la validez de lo que envió; en cualquiera de los
 * dos casos el nombre no cambia.
 */
@Injectable()
export class RenameGroup {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
    @Inject(GROUPS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    name: string,
  ): Promise<GroupDetail> {
    const { group, membership } = await resolveGroupAccess(
      this.groups,
      groupId,
      userId,
    );
    if (!canRenameGroup(membership.role)) {
      throw new OwnerRoleRequired();
    }
    const normalized = normalizeGroupName(name);
    if (!isValidGroupName(normalized)) {
      throw new InvalidGroupName();
    }
    const renamed = await this.groups.rename(
      group.id,
      normalized,
      this.clock.now(),
    );
    if (renamed === null) {
      // Alguien borró el grupo entre la lectura y la escritura.
      throw new GroupNotFound();
    }
    const counts = await this.groups.countMembers([group.id]);
    return toGroupDetail(renamed, membership.role, counts.get(group.id) ?? 0, {
      includeInviteCode: true,
    });
  }
}
