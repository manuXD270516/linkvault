import type { NotificationPreferences } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { effectivePreferences } from '../domain/preferences';
import {
  NOTIFICATION_PREFERENCES_REPOSITORY,
  type NotificationPreferencesRepository,
} from './ports/notification-preferences.repository.port';

@Injectable()
export class GetNotificationPreferences {
  constructor(
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY)
    private readonly preferences: NotificationPreferencesRepository,
  ) {}

  async execute(userId: string): Promise<NotificationPreferences> {
    const stored = await this.preferences.findByUserId(userId);
    return effectivePreferences(stored);
  }
}
