import type { GroupDetail } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  AlreadyOwner,
  MemberNotFound,
  OwnerRoleRequired,
} from '../domain/errors';
import { canTransferOwnership, isOtherMember } from '../domain/membership';
import { resolveGroupAccess } from './group-access';
import { toGroupDetail } from './group.mapper';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `POST /api/groups/:id/owner` (spec groups/membership, D1 de groups-ownership-join-limit): el owner nombra owner a otro
 * miembro y pasa a ser `member`. Errores, en este orden: `group_not_found` (no es miembro o `:id` mal formado),
 * `forbidden` (no es owner), `already_owner` (se nombra a sí mismo) y `member_not_found` (el elegido no es miembro o su
 * id está mal formado).
 *
 * El rol se comprueba al leer para responder el error correcto, y el repositorio lo vuelve a comprobar al escribir: si
 * otra petición le quitó la propiedad entre medias, `not_owner` también es `forbidden`. Responde el detalle visto por
 * quien pide, que ya es `member`, así que sin código de invitación.
 */
@Injectable()
export class TransferOwnership {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    targetUserId: string,
  ): Promise<GroupDetail> {
    const { group, membership } = await resolveGroupAccess(
      this.groups,
      groupId,
      userId,
    );
    if (!canTransferOwnership(membership.role)) {
      throw new OwnerRoleRequired();
    }
    if (!isOtherMember(userId, targetUserId)) {
      throw new AlreadyOwner();
    }
    const result = await this.groups.transferOwnership(
      group.id,
      userId,
      targetUserId,
    );
    switch (result) {
      case 'not_owner':
        throw new OwnerRoleRequired();
      case 'target_not_member':
        throw new MemberNotFound();
      case 'transferred':
        break;
    }
    const counts = await this.groups.countMembers([group.id]);
    return toGroupDetail(group, 'member', counts.get(group.id) ?? 0, {
      includeInviteCode: false,
    });
  }
}
