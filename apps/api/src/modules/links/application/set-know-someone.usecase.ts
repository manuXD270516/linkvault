import type {
  SetKnowSomeoneRequest,
  SetKnowSomeoneResponse,
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
 * `PUT /api/groups/:id/links/:linkId/know-someone` (D2 de know-someone-flag). Cualquier miembro puede marcar o
 * desmarcar su propio flag. Sin `403`: el toggle es del propio usuario. ACL:
 * 1. no miembro / grupo inválido → `404 group_not_found`;
 * 2. relación ausente → `404 link_not_found`;
 * 3. `$addToSet` / `$pull` atómico; respuesta desde el documento after.
 */
@Injectable()
export class SetKnowSomeone {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
    body: SetKnowSomeoneRequest,
  ): Promise<SetKnowSomeoneResponse> {
    const role = await this.membership.membershipOf(groupId, userId);
    if (role === null) {
      throw new CommentsGroupNotFound();
    }
    const state = await this.groupLinks.setKnowSomeone(
      groupId,
      linkId,
      userId,
      body.flagged,
    );
    if (state === null) {
      throw new LinkNotFound();
    }
    return state;
  }
}
