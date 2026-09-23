import type {
  SetGroupLinkPinnedRequest,
  SetGroupLinkPinnedResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { CommentsGroupNotFound, LinkNotFound } from '../domain/errors';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';

/**
 * `PUT /api/groups/:id/links/:linkId/pinned` (D2/D4 de group-link-tags-pinned). Cualquier miembro fija o desfija.
 * Sin outbox. ACL como know-someone:
 * 1. no miembro / grupo inválido → `404 group_not_found`;
 * 2. relación ausente → `404 link_not_found`.
 */
@Injectable()
export class SetGroupLinkPinned {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
    body: SetGroupLinkPinnedRequest,
  ): Promise<SetGroupLinkPinnedResponse> {
    const role = await this.membership.membershipOf(groupId, userId);
    if (role === null) {
      throw new CommentsGroupNotFound();
    }
    const pinned = await this.groupLinks.setPinned(
      groupId,
      linkId,
      body.pinned,
    );
    if (pinned === null) {
      throw new LinkNotFound();
    }
    return { pinned };
  }
}
