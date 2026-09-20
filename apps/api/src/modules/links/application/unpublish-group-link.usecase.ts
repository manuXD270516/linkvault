import { Inject, Injectable } from '@nestjs/common';
import {
  CommentsGroupNotFound,
  PublicShareForbidden,
  PublicShareNotFound,
} from '../domain/errors';
import { mayPublish } from '../domain/public-share';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';

/**
 * `DELETE /api/groups/:id/links/:linkId/public` (spec links/public-share, D2): las **mismas tres comprobaciones** que
 * publicar, en el mismo orden, y después el borrado. Responde `204` estuviera publicado o no, porque decir "no estaba"
 * le contaría el estado del interruptor a quien acaba de intentar cambiarlo.
 *
 * Despublicar **quema** el slug: quien tenga esa URL recibe `404` desde este momento y volver a publicar genera otro.
 */
@Injectable()
export class UnpublishGroupLink {
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
      throw new CommentsGroupNotFound();
    }
    const relation = await this.groupLinks.find(groupId, linkId);
    if (relation === null) {
      throw new PublicShareNotFound();
    }
    if (!mayPublish(userId, relation.sharedBy, role)) {
      throw new PublicShareForbidden();
    }
    if (!(await this.groupLinks.unpublish(groupId, linkId))) {
      // La relación desapareció entre la comprobación y la escritura.
      throw new PublicShareNotFound();
    }
  }
}
