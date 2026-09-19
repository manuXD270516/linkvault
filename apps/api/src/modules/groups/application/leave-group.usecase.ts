import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound, OwnerCannotLeave } from '../domain/errors';
import { canLeaveGroup } from '../domain/membership';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `DELETE /api/groups/:id/members/me` (spec groups/membership): el miembro suelta su membresía. El owner no puede salir
 * (hoy no hay transferencia de propiedad): recibe `owner_cannot_leave` y sigue dentro.
 *
 * A diferencia del resto, no exige que el grupo exista: opera sobre la membresía, así que una huérfana también se puede
 * soltar y liberar la plaza que ocupa en el límite del usuario (D6).
 */
@Injectable()
export class LeaveGroup {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
  ) {}

  async execute(userId: string, groupId: string): Promise<void> {
    const membership = await this.groups.findMembership(groupId, userId);
    if (membership === null) {
      throw new GroupNotFound();
    }
    if (!canLeaveGroup(membership.role)) {
      throw new OwnerCannotLeave();
    }
    const removed = await this.groups.removeMember(groupId, userId);
    if (removed !== 'removed') {
      // Otra petición la soltó antes; para quien pregunta, ya no es miembro.
      throw new GroupNotFound();
    }
  }
}
