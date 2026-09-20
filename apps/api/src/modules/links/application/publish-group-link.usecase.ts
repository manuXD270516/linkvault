import type { PublicShare } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  CommentsGroupNotFound,
  PublicShareForbidden,
  PublicShareNotFound,
} from '../domain/errors';
import { mayPublish } from '../domain/public-share';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';
import { PUBLIC_URLS, type PublicUrls } from './ports/public-urls.port';
import { toPublicShareView } from './public-share.mapper';

/**
 * `PUT /api/groups/:id/links/:linkId/public` (spec links/public-share, D2). El orden de las comprobaciones es el del
 * `DELETE` de la nota (ADR-026 §3) y por el mismo motivo: la respuesta no le revela a quien no puede tocarlo si el link
 * estaba publicado.
 *
 * 1. pertenencia: quien no es miembro recibe `group_not_found`;
 * 2. relación: un link que no está en el grupo, `link_not_found`;
 * 3. permiso: quien no compartió el link y no es `owner`, `forbidden`, **esté o no publicado**;
 * 4. publicación: **idempotente**, así que dos pestañas no dejan dos enlaces vivos. El slug y su reintento viven en el
 *    repositorio (D2): aquí no se ve ni el generador ni un `E11000`.
 */
@Injectable()
export class PublishGroupLink {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(PUBLIC_URLS) private readonly urls: PublicUrls,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
  ): Promise<PublicShare> {
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
    const published = await this.groupLinks.publish(
      groupId,
      linkId,
      userId,
      this.clock.now(),
    );
    if (published === null) {
      // La relación desapareció entre la comprobación y la escritura.
      throw new PublicShareNotFound();
    }
    return toPublicShareView(published, this.urls);
  }
}
