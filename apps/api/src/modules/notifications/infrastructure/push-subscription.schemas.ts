import { Schema, type HydratedDocument } from 'mongoose';

export const PUSH_SUBSCRIPTION_MODEL = 'PushSubscription';
export const PUSH_SUBSCRIPTIONS_COLLECTION = 'push_subscriptions';

export interface PushSubscriptionDocument {
  userId: import('mongoose').Types.ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
}

export type PushSubscriptionHydrated =
  HydratedDocument<PushSubscriptionDocument>;

export const pushSubscriptionSchema = new Schema<PushSubscriptionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    endpoint: { type: String, required: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: PUSH_SUBSCRIPTIONS_COLLECTION },
);

pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ endpoint: 1 });
