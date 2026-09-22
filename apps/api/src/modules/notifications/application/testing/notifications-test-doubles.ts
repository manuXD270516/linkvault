import type {
  NotificationPreferences,
  PatchNotificationPreferencesRequest,
} from '@linkvault/shared';
import type { NotificationPreferencesRepository } from '../ports/notification-preferences.repository.port';

export class InMemoryNotificationPreferencesRepository
  implements NotificationPreferencesRepository
{
  private readonly byUser = new Map<string, NotificationPreferences>();

  findByUserId(userId: string): Promise<NotificationPreferences | null> {
    return Promise.resolve(this.byUser.get(userId) ?? null);
  }

  save(
    userId: string,
    preferences: NotificationPreferences,
    _updatedAt: Date,
  ): Promise<NotificationPreferences> {
    this.byUser.set(userId, preferences);
    return Promise.resolve(preferences);
  }

  deleteByUserId(userId: string): Promise<void> {
    this.byUser.delete(userId);
    return Promise.resolve();
  }

  /** Test helper. */
  clear(): void {
    this.byUser.clear();
  }
}

export class AlwaysMemberMembership {
  isMember(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export class NeverMemberMembership {
  isMember(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export class SelectiveMembership {
  constructor(private readonly memberOf: ReadonlySet<string>) {}

  isMember(groupId: string, _userId: string): Promise<boolean> {
    return Promise.resolve(this.memberOf.has(groupId));
  }
}

export function fixedClock(now: Date): { now: () => Date } {
  return { now: () => now };
}

export type { PatchNotificationPreferencesRequest };
