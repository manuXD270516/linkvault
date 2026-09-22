import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession } from 'mongoose';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import type {
  DeliveryKey,
  NotificationDeliveryRepository,
} from '../application/ports/notification-delivery.repository.port';
import {
  NOTIFICATION_DELIVERY_MODEL,
  type NotificationDeliveryDocument,
} from './notification-delivery.schemas';

/** Lease de un claim en vuelo: si caduca, se puede reclamar de nuevo. */
export const DELIVERY_CLAIM_LEASE_MS = 5 * 60_000;

@Injectable()
export class MongoNotificationDeliveryRepository
  implements NotificationDeliveryRepository
{
  constructor(
    @InjectModel(NOTIFICATION_DELIVERY_MODEL)
    private readonly model: Model<NotificationDeliveryDocument>,
  ) {}

  async claim(
    key: DeliveryKey,
    now: Date,
  ): Promise<'claimed' | 'already_done' | 'in_flight'> {
    const oid = toObjectId(key.userId);
    if (oid === null) {
      throw new Error(`Malformed user id "${key.userId}"`);
    }
    const filter = {
      type: key.type,
      aggregateKey: key.aggregateKey,
      userId: oid,
      channel: key.channel,
    };
    const existing = await this.model.findOne(filter).lean().exec();
    if (existing !== null) {
      if (existing.status === 'completed' || existing.status === 'failed') {
        return 'already_done';
      }
      const age = now.getTime() - existing.claimedAt.getTime();
      if (existing.status === 'claimed' && age < DELIVERY_CLAIM_LEASE_MS) {
        return 'in_flight';
      }
      await this.model
        .updateOne(filter, {
          $set: { status: 'claimed', claimedAt: now, updatedAt: now },
        })
        .exec();
      return 'claimed';
    }
    try {
      await this.model.create({
        ...filter,
        status: 'claimed',
        claimedAt: now,
        updatedAt: now,
      });
      return 'claimed';
    } catch (error: unknown) {
      if (isDuplicateKey(error)) {
        return this.claim(key, now);
      }
      throw error;
    }
  }

  async markCompleted(key: DeliveryKey, now: Date): Promise<void> {
    await this.setStatus(key, 'completed', now);
  }

  async markFailed(key: DeliveryKey, now: Date): Promise<void> {
    await this.setStatus(key, 'failed', now);
  }

  async deleteByUserId(
    userId: string,
    session?: TransactionSession,
  ): Promise<void> {
    const oid = toObjectId(userId);
    if (oid === null) {
      return;
    }
    const query = this.model.deleteMany({ userId: oid });
    if (session !== undefined) {
      query.session(session as ClientSession);
    }
    await query.exec();
  }

  private async setStatus(
    key: DeliveryKey,
    status: 'completed' | 'failed',
    now: Date,
  ): Promise<void> {
    const oid = toObjectId(key.userId);
    if (oid === null) {
      return;
    }
    await this.model
      .updateOne(
        {
          type: key.type,
          aggregateKey: key.aggregateKey,
          userId: oid,
          channel: key.channel,
        },
        { $set: { status, updatedAt: now } },
      )
      .exec();
  }
}

function toObjectId(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 11000
  );
}
