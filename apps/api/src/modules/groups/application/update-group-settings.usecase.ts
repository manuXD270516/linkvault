import type { GroupDetail, GroupVisibility } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound, OwnerRoleRequired } from '../domain/errors';
import { canChangeDefaultVisibility } from '../domain/group';
import { resolveGroupAccess } from './group-access';
import { toGroupDetail } from './group.mapper';
import { GROUPS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `PATCH /api/groups/:id/settings` (spec groups/group-management, D3 de public-preview-share): solo el owner cambia la
 * visibilidad por defecto del grupo. El orden es el de `RenameGroup`: quien no es miembro recibe `group_not_found` y un
 * miembro que no es owner, `forbidden`.
 *
 * Cambiar el ajuste **no escribe en ningún link**: ni publica, ni despublica, ni sube ninguna revisión. Solo decide qué
 * pasa cuando **entre** un link a partir de ahora. Apagarlo y despublicar cien enlaces ya repartidos por WhatsApp, o
 * encenderlo y publicar de golpe lo que un grupo llevaba meses guardando, serían daños irreversibles hechos por un clic.
 */
@Injectable()
export class UpdateGroupSettings {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
    @Inject(GROUPS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    defaultVisibility: GroupVisibility,
  ): Promise<GroupDetail> {
    const { group, membership } = await resolveGroupAccess(
      this.groups,
      groupId,
      userId,
    );
    if (!canChangeDefaultVisibility(membership.role)) {
      throw new OwnerRoleRequired();
    }
    const updated = await this.groups.updateSettings(
      group.id,
      defaultVisibility,
      this.clock.now(),
    );
    if (updated === null) {
      // Alguien borró el grupo entre la lectura y la escritura.
      throw new GroupNotFound();
    }
    const counts = await this.groups.countMembers([group.id]);
    return toGroupDetail(updated, membership.role, counts.get(group.id) ?? 0, {
      includeInviteCode: true,
    });
  }
}
