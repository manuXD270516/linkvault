import type { InviteCodeResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound, OwnerRoleRequired } from '../domain/errors';
import { canRotateInviteCode } from '../domain/membership';
import { resolveGroupAccess } from './group-access';
import { GROUPS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `POST /api/groups/:id/invite-code` (spec groups/group-management): solo el owner regenera el código. El anterior deja
 * de servir en cuanto se guarda el nuevo; los miembros actuales siguen dentro, porque la pertenencia vive en la
 * membresía y no en el código.
 */
@Injectable()
export class RotateInviteCode {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
    @Inject(GROUPS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, groupId: string): Promise<InviteCodeResponse> {
    const { group, membership } = await resolveGroupAccess(
      this.groups,
      groupId,
      userId,
    );
    if (!canRotateInviteCode(membership.role)) {
      throw new OwnerRoleRequired();
    }
    const rotated = await this.groups.rotateInviteCode(
      group.id,
      this.clock.now(),
    );
    if (rotated === null) {
      // Alguien borró el grupo entre la lectura y la escritura.
      throw new GroupNotFound();
    }
    return { inviteCode: rotated.inviteCode };
  }
}
