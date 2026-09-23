import { Schema, type HydratedDocument } from 'mongoose';

export const NOTIFICATION_PREFERENCES_MODEL = 'NotificationPreferences';
export const NOTIFICATION_PREFERENCES_COLLECTION = 'notification_preferences';

export interface NotificationPreferencesDocument {
  userId: import('mongoose').Types.ObjectId;
  groupNewLink: boolean;
  applicationStatusGroup: boolean;
  applicationStale: boolean;
  groupWeeklyDigest: boolean;
  notifyOwnActions: boolean;
  applicationStatusGroupId: string | null;
  updatedAt: Date;
}

export type NotificationPreferencesHydrated =
  HydratedDocument<NotificationPreferencesDocument>;

export const notificationPreferencesSchema =
  new Schema<NotificationPreferencesDocument>(
    {
      userId: { type: Schema.Types.ObjectId, required: true, unique: true },
      groupNewLink: { type: Boolean, required: true },
      applicationStatusGroup: { type: Boolean, required: true },
      applicationStale: { type: Boolean, required: true },
      groupWeeklyDigest: { type: Boolean, required: true },
      notifyOwnActions: { type: Boolean, required: true },
      applicationStatusGroupId: { type: String, default: null },
      updatedAt: { type: Date, required: true },
    },
    { collection: NOTIFICATION_PREFERENCES_COLLECTION },
  );
