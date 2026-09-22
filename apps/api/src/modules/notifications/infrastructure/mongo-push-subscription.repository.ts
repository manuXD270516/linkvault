import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type ClientSession } from 'mongoose';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import type {
  PushSubscriptionRepository,
  UpsertPushResult,
} from '../application/ports/push-subscription.repository.port';
import type {
  NewPushSubscription,
  PushSubscription,
} from '../domain/push-subscription';
import {
  PUSH_SUBSCRIPTION_MODEL,
  type PushSubscriptionDocument,
} from './push-subscription.schemas';

@Injectable()
export class MongoPushSubscriptionRepository
  implements PushSubscriptionRepository
{
  constructor(
    @InjectModel(PUSH_SUBSCRIPTION_MODEL)
    private readonly model: Model<PushSubscriptionDocument>,
  ) {}

  async upsert(input: NewPushSubscription): Promise<UpsertPushResult> {
    const oid = toObjectId(input.userId);
    if (oid === null) {
      throw new Error(`Malformed user id "${input.userId}"`);
    }
    const existing = await this.model
      .findOne({ userId: oid, endpoint: input.endpoint })
      .lean()
      .exec();
    if (existing !== null) {
      await this.model
        .updateOne(
          { _id: existing._id },
          { $set: { p256dh: input.p256dh, auth: input.auth } },
        )
        .exec();
      return {
        subscription: {
          userId: input.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          createdAt: existing.createdAt,
        },
        created: false,
      };
    }
    await this.model.create({
      userId: oid,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: input.createdAt,
    });
    return { subscription: input, created: true };
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    const oid = toObjectId(userId);
    if (oid === null) {
      return;
    }
    await this.model.deleteOne({ userId: oid, endpoint }).exec();
  }

  async listByUserId(userId: string): Promise<readonly PushSubscription[]> {
    const oid = toObjectId(userId);
    if (oid === null) {
      return [];
    }
    const docs = await this.model.find({ userId: oid }).lean().exec();
    return docs.map((doc) => ({
      userId,
      endpoint: doc.endpoint,
      p256dh: doc.p256dh,
      auth: doc.auth,
      createdAt: doc.createdAt,
    }));
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

  async deleteEndpoint(endpoint: string): Promise<void> {
    await this.model.deleteMany({ endpoint }).exec();
  }
}

function toObjectId(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}
