import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from '../application/ports/group-link-repository.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import { SearchFacade } from '../../search/application/search.facade';

/**
 * Limpieza de `links` cuando se borra un grupo (D7b + search C1/D9):
 * purge Meili del groupId (si FEATURE_SEARCH) y SearchUpsert de previews afectados vía outbox.
 */
@Injectable()
export class GroupLinksDeletionHook {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Optional() private readonly search?: SearchFacade,
  ) {}

  async deleteRelationsOf(
    groupId: string,
    session: TransactionSession,
  ): Promise<void> {
    const linkIds: string[] = [];
    let cursor: { date: Date; relationId: string } | undefined;
    for (;;) {
      const page = await this.groupLinks.listByGroup(groupId, {
        limit: 50,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const item of page.items) {
        linkIds.push(item.link.id);
      }
      if (page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }

    if (this.search !== undefined) {
      await this.search.purgeGroup(groupId);
    }

    await this.groupLinks.deleteByGroup(groupId, session);

    if (this.search?.enabled === true) {
      for (const linkId of linkIds) {
        await this.search.upsert(
          {
            docType: 'job_preview',
            aggregateId: linkId,
            reason: 'group_deleted',
            fingerprint: `group-del:${linkId}:${groupId}`,
          },
          session,
        );
      }
    }
  }
}
