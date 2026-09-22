import type {
  NotificationPreferences,
  PatchNotificationPreferencesRequest,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { NotifyGroupNotAllowed } from '../domain/errors';
import {
  applyPreferencePatch,
  effectivePreferences,
} from '../domain/preferences';
import { NOTIFICATIONS_CLOCK, type Clock } from './ports/clock.port';
import {
  NOTIFICATION_GROUP_MEMBERSHIP,
  type NotificationGroupMembership,
} from './ports/notification-group-membership.port';
import {
  NOTIFICATION_PREFERENCES_REPOSITORY,
  type NotificationPreferencesRepository,
} from './ports/notification-preferences.repository.port';

@Injectable()
export class UpdateNotificationPreferences {
  constructor(
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY)
    private readonly preferences: NotificationPreferencesRepository,
    @Inject(NOTIFICATION_GROUP_MEMBERSHIP)
    private readonly membership: NotificationGroupMembership,
    @Inject(NOTIFICATIONS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    patch: PatchNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    if (patch.applicationStatusGroupId) {
      const member = await this.membership.isMember(
        patch.applicationStatusGroupId,
        userId,
      );
      if (!member) {
        throw new NotifyGroupNotAllowed();
      }
    }
    const current = effectivePreferences(
      await this.preferences.findByUserId(userId),
    );
    const next = applyPreferencePatch(current, patch);
    return await this.preferences.save(userId, next, this.clock.now());
  }
}
