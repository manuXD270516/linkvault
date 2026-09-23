import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession } from 'mongoose';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import type { NotificationPreferencesRepository } from '../application/ports/notification-preferences.repository.port';
import {
  NOTIFICATION_PREFERENCES_MODEL,
  type NotificationPreferencesDocument,
} from './notification-preferences.schemas';

@Injectable()
export class MongoNotificationPreferencesRepository
  implements NotificationPreferencesRepository
{
  constructor(
    @InjectModel(NOTIFICATION_PREFERENCES_MODEL)
    private readonly model: Model<NotificationPreferencesDocument>,
  ) {}

  async findByUserId(userId: string): Promise<NotificationPreferences | null> {
    const oid = toObjectId(userId);
    if (oid === null) {
      return null;
    }
    const doc = await this.model.findOne({ userId: oid }).lean().exec();
    return doc === null ? null : toPreferences(doc);
  }

  async save(
    userId: string,
    preferences: NotificationPreferences,
    updatedAt: Date,
  ): Promise<NotificationPreferences> {
    const oid = toObjectId(userId);
    if (oid === null) {
      throw new Error(`Malformed user id "${userId}"`);
    }
    await this.model
      .findOneAndUpdate(
        { userId: oid },
        {
          $set: {
            groupNewLink: preferences.groupNewLink,
            applicationStatusGroup: preferences.applicationStatusGroup,
            applicationStale: preferences.applicationStale,
            groupWeeklyDigest: preferences.groupWeeklyDigest,
            notifyOwnActions: preferences.notifyOwnActions,
            applicationStatusGroupId: preferences.applicationStatusGroupId,
            updatedAt,
          },
          $setOnInsert: { userId: oid },
        },
        { upsert: true },
      )
      .exec();
    return preferences;
  }

  async deleteByUserId(
    userId: string,
    session?: TransactionSession,
  ): Promise<void> {
    const oid = toObjectId(userId);
    if (oid === null) {
      return;
    }
    const query = this.model.deleteOne({ userId: oid });
    if (session !== undefined) {
      query.session(session as ClientSession);
    }
    await query.exec();
  }
}

function toPreferences(
  doc: NotificationPreferencesDocument,
): NotificationPreferences {
  return {
    groupNewLink: doc.groupNewLink ?? DEFAULT_NOTIFICATION_PREFERENCES.groupNewLink,
    applicationStatusGroup:
      doc.applicationStatusGroup ??
      DEFAULT_NOTIFICATION_PREFERENCES.applicationStatusGroup,
    applicationStale:
      doc.applicationStale ?? DEFAULT_NOTIFICATION_PREFERENCES.applicationStale,
    groupWeeklyDigest:
      doc.groupWeeklyDigest ??
      DEFAULT_NOTIFICATION_PREFERENCES.groupWeeklyDigest,
    notifyOwnActions:
      doc.notifyOwnActions ?? DEFAULT_NOTIFICATION_PREFERENCES.notifyOwnActions,
    applicationStatusGroupId: doc.applicationStatusGroupId ?? null,
  };
}

function toObjectId(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}
