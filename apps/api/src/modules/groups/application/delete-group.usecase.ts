import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound, OwnerRoleRequired } from '../domain/errors';
import { canDeleteGroup } from '../domain/membership';
import { resolveGroupAccess } from './group-access';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `DELETE /api/groups/:id` (spec groups/group-management): solo el owner borra, y el borrado es real (hoy no cuelga nada
 * del grupo). El grupo y todas sus membresías se van en una transacción, así que después el grupo no aparece en la lista
 * de nadie y su código de invitación deja de servir.
 */
@Injectable()
export class DeleteGroup {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
  ) {}

  async execute(userId: string, groupId: string): Promise<void> {
    const { group, membership } = await resolveGroupAccess(
      this.groups,
      groupId,
      userId,
    );
    if (!canDeleteGroup(membership.role)) {
      throw new OwnerRoleRequired();
    }
    const deleted = await this.groups.deleteGroup(group.id);
    if (!deleted) {
      // Otro borrado ganó la carrera; para quien pregunta, el grupo ya no existe.
      throw new GroupNotFound();
    }
  }
}
