import { Inject, Injectable, Optional } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { GroupNotFound } from '../../groups/domain/errors';
import { LinkNotFound, LinkRemovalForbidden } from '../domain/errors';
import { SearchFacade } from '../../search/application/search.facade';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';

/**
 * `DELETE /api/groups/:id/links/:linkId` (spec links/sharing) + Search* outbox si FEATURE_SEARCH (C1).
 */
@Injectable()
export class RemoveGroupLink {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Optional() private readonly search?: SearchFacade,
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
      throw new LinkNotFound();
    }
    if (this.search?.enabled !== true) {
      return;
    }
    const search = this.search;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await search.upsert(
          {
            docType: 'job_preview',
            aggregateId: linkId,
            reason: 'group_link_unshared',
            fingerprint: `unshare:${linkId}:${groupId}:${Date.now()}`,
          },
          session,
        );
        await search.delete(
          {
            docType: 'group_link_note',
            aggregateId: `${groupId}_${linkId}`,
            reason: 'group_link_removed',
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
}
