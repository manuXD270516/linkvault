import type { NotificationPreferences } from '@linkvault/shared';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';

export const NOTIFICATION_PREFERENCES_REPOSITORY = Symbol(
  'NOTIFICATION_PREFERENCES_REPOSITORY',
);

export interface NotificationPreferencesRepository {
  /** Preferencias persistidas, o `null` si no hay documento (defaults). */
  findByUserId(userId: string): Promise<NotificationPreferences | null>;

  /** Upsert completo de preferencias. */
  save(
    userId: string,
    preferences: NotificationPreferences,
    updatedAt: Date,
  ): Promise<NotificationPreferences>;

  /** Borra preferencias del usuario (cascada de cuenta). */
  deleteByUserId(
    userId: string,
    session?: TransactionSession,
  ): Promise<void>;
}
