import type {
  SetGroupLinkTagsRequest,
  SetGroupLinkTagsResponse,
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
 * `PUT /api/groups/:id/links/:linkId/tags` (D3/D4 de group-link-tags-pinned). Cualquier miembro reemplaza el array
 * completo (`$set`). Sin outbox. ACL como know-someone:
 * 1. no miembro / grupo inválido → `404 group_not_found`;
 * 2. relación ausente → `404 link_not_found`.
 */
@Injectable()
export class SetGroupLinkTags {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
    body: SetGroupLinkTagsRequest,
  ): Promise<SetGroupLinkTagsResponse> {
    const role = await this.membership.membershipOf(groupId, userId);
    if (role === null) {
      throw new CommentsGroupNotFound();
    }
    const tags = await this.groupLinks.setTags(groupId, linkId, body.tags);
    if (tags === null) {
      throw new LinkNotFound();
    }
    return { tags: [...tags] };
  }
}
