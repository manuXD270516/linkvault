import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound, OwnerCannotLeave } from '../domain/errors';
import { canLeaveGroup } from '../domain/membership';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `DELETE /api/groups/:id/members/me` (spec groups/membership): el miembro suelta su membresía. El owner no puede salir
 * mientras lo sea: recibe `owner_cannot_leave` y sigue dentro; para irse, primero nombra owner a otro miembro. Si recibe
 * la propiedad entre la lectura y la escritura, el repositorio no la borra (`now_owner`) y recibe el mismo error.
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
    switch (removed) {
      case 'removed':
        return;
      case 'now_owner':
        // Acaba de recibir la propiedad: sigue dentro, como cualquier owner.
        throw new OwnerCannotLeave();
      case 'not_member':
        // Otra petición la soltó antes; para quien pregunta, ya no es miembro.
        throw new GroupNotFound();
    }
  }
}
