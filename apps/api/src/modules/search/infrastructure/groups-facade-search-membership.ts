import { Injectable } from '@nestjs/common';
import { GroupsFacade } from '../../groups/application/groups.facade';
import type { SearchMembership } from '../application/ports/search-membership.port';

@Injectable()
export class GroupsFacadeSearchMembership implements SearchMembership {
  constructor(private readonly groups: GroupsFacade) {}

  async groupIdsOf(userId: string): Promise<readonly string[]> {
    const memberships = await this.groups.getGroupsOf(userId);
    return memberships.map((m) => m.groupId);
  }
}
