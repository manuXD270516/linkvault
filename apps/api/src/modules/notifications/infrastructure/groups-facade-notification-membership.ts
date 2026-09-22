import { Injectable } from '@nestjs/common';
import { GroupsFacade } from '../../groups/application/groups.facade';
import type { NotificationGroupMembership } from '../application/ports/notification-group-membership.port';

@Injectable()
export class GroupsFacadeNotificationMembership
  implements NotificationGroupMembership
{
  constructor(private readonly groups: GroupsFacade) {}

  isMember(groupId: string, userId: string): Promise<boolean> {
    return this.groups.isMember(groupId, userId);
  }
}
