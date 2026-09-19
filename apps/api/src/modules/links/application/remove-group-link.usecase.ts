import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound } from '../../groups/domain/errors';
import { LinkNotFound, LinkRemovalForbidden } from '../domain/errors';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';

/**
 * `DELETE /api/groups/:id/links/:linkId` (spec links/sharing): quitar del grupo lo que no era una oferta. Lo puede hacer
 * quien lo compartió y el `owner`, que limpia su grupo; otro miembro recibe `forbidden`, porque ya sabe que el link
 * existe y no hay nada que ocultarle. Quien no es miembro recibe `group_not_found`, como si el grupo no existiera.
 *
 * Solo se borra la **relación**: el `JobLink` sigue disponible en los demás grupos y en las listas privadas, así que la
 * limpieza de un grupo nunca hace desaparecer la oferta de otro.
 */
@Injectable()
export class RemoveGroupLink {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
  ): Promise<void> {
    const role = await this.membership.membershipOf(groupId, userId);
    if (role === null) {
      throw new GroupNotFound();
    }
    const relation = await this.groupLinks.find(groupId, linkId);
    if (relation === null) {
      throw new LinkNotFound();
    }
    if (relation.sharedBy !== userId && role !== 'owner') {
      throw new LinkRemovalForbidden();
    }
    if (!(await this.groupLinks.removeWithComments(groupId, linkId))) {
      // Otra petición se le adelantó: para quien pide, el link ya no está en el grupo.
      throw new LinkNotFound();
    }
  }
}
