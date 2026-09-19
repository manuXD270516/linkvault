import { Inject, Injectable } from '@nestjs/common';
import {
  MemberNotFound,
  OwnerCannotLeave,
  OwnerRoleRequired,
} from '../domain/errors';
import { canBeRemoved, canRemoveMembers } from '../domain/membership';
import { resolveGroupAccess } from './group-access';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `DELETE /api/groups/:id/members/:userId` (spec groups/membership): solo el owner expulsa. La membresía `owner` no se
 * puede eliminar, así que el owner sobre sí mismo recibe `owner_cannot_leave` y el grupo conserva su única membresía
 * `owner`. Un usuario que no es miembro, o un `:userId` mal formado, dan `member_not_found`. El expulsado puede volver a
 * entrar con el código vigente: por eso, tras expulsar, la UI ofrece regenerarlo.
 *
 * Si el expulsado recibe la propiedad entre la lectura y la escritura, el repositorio no lo borra (`now_owner`) y quien
 * expulsaba recibe `forbidden`: acaba de ceder la propiedad a ese mismo miembro, así que ya no es owner (ADR-025 §3).
 */
@Injectable()
export class RemoveMember {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    memberId: string,
  ): Promise<void> {
    const { group, membership } = await resolveGroupAccess(
      this.groups,
      groupId,
      userId,
    );
    if (!canRemoveMembers(membership.role)) {
      throw new OwnerRoleRequired();
    }
    const target = await this.groups.findMembership(group.id, memberId);
    if (target === null) {
      throw new MemberNotFound();
    }
    if (!canBeRemoved(target.role)) {
      throw new OwnerCannotLeave();
    }
    const removed = await this.groups.removeMember(group.id, memberId);
    switch (removed) {
      case 'removed':
        return;
      case 'now_owner':
        throw new OwnerRoleRequired();
      case 'not_member':
        // Otra petición la soltó antes; para quien pregunta, ya no es miembro.
        throw new MemberNotFound();
    }
  }
}
