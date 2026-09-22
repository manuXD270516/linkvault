import { Schema } from 'mongoose';

export const NOTIFICATION_DELIVERY_MODEL = 'NotificationDelivery';
export const NOTIFICATION_DELIVERIES_COLLECTION = 'notification_deliveries';

export interface NotificationDeliveryDocument {
  type: string;
  aggregateKey: string;
  userId: import('mongoose').Types.ObjectId;
  channel: 'email' | 'push';
  status: 'claimed' | 'completed' | 'failed';
  claimedAt: Date;
  updatedAt: Date;
}

export const notificationDeliverySchema =
  new Schema<NotificationDeliveryDocument>(
    {
      type: { type: String, required: true },
      aggregateKey: { type: String, required: true },
      userId: { type: Schema.Types.ObjectId, required: true },
      channel: { type: String, required: true, enum: ['email', 'push'] },
      status: {
        type: String,
        required: true,
        enum: ['claimed', 'completed', 'failed'],
      },
      claimedAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: NOTIFICATION_DELIVERIES_COLLECTION },
  );

notificationDeliverySchema.index(
  { type: 1, aggregateKey: 1, userId: 1, channel: 1 },
  { unique: true },
);
notificationDeliverySchema.index({ userId: 1 });
