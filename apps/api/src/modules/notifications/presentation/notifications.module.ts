import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { GroupsModule } from '../../groups/presentation/groups.module';
import { DeletePushSubscription } from '../application/delete-push-subscription.usecase';
import { GetNotificationPreferences } from '../application/get-notification-preferences.usecase';
import { GetVapidPublicKey } from '../application/get-vapid-public-key.usecase';
import { NOTIFICATIONS_CLOCK } from '../application/ports/clock.port';
import { NOTIFICATION_DELIVERY_REPOSITORY } from '../application/ports/notification-delivery.repository.port';
import { NOTIFICATION_GROUP_MEMBERSHIP } from '../application/ports/notification-group-membership.port';
import { NOTIFICATION_PREFERENCES_REPOSITORY } from '../application/ports/notification-preferences.repository.port';
import { PUSH_SUBSCRIPTION_REPOSITORY } from '../application/ports/push-subscription.repository.port';
import { VAPID_CONFIG } from '../application/ports/vapid-config.port';
import { RegisterPushSubscription } from '../application/register-push-subscription.usecase';
import { UpdateNotificationPreferences } from '../application/update-notification-preferences.usecase';
import { GroupsFacadeNotificationMembership } from '../infrastructure/groups-facade-notification-membership';
import { MongoNotificationDeliveryRepository } from '../infrastructure/mongo-notification-delivery.repository';
import { MongoNotificationPreferencesRepository } from '../infrastructure/mongo-notification-preferences.repository';
import { MongoPushSubscriptionRepository } from '../infrastructure/mongo-push-subscription.repository';
import {
  NOTIFICATION_DELIVERY_MODEL,
  notificationDeliverySchema,
} from '../infrastructure/notification-delivery.schemas';
import {
  NOTIFICATION_PREFERENCES_MODEL,
  notificationPreferencesSchema,
} from '../infrastructure/notification-preferences.schemas';
import {
  PUSH_SUBSCRIPTION_MODEL,
  pushSubscriptionSchema,
} from '../infrastructure/push-subscription.schemas';
import { SystemClock } from '../infrastructure/system-clock';
import { NotificationsController } from './notifications.controller';

function vapidFromConfig(config: ApiConfig) {
  const publicKey = config.VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = config.VAPID_PRIVATE_KEY?.trim() || null;
  const subject = config.VAPID_SUBJECT?.trim() || null;
  return { publicKey, privateKey, subject };
}

@Module({
  imports: [
    GroupsModule,
    MongooseModule.forFeature([
      {
        name: NOTIFICATION_PREFERENCES_MODEL,
        schema: notificationPreferencesSchema,
      },
      { name: PUSH_SUBSCRIPTION_MODEL, schema: pushSubscriptionSchema },
      {
        name: NOTIFICATION_DELIVERY_MODEL,
        schema: notificationDeliverySchema,
      },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATIONS_CLOCK, useClass: SystemClock },
    {
      provide: NOTIFICATION_PREFERENCES_REPOSITORY,
      useClass: MongoNotificationPreferencesRepository,
    },
    {
      provide: PUSH_SUBSCRIPTION_REPOSITORY,
      useClass: MongoPushSubscriptionRepository,
    },
    {
      provide: NOTIFICATION_DELIVERY_REPOSITORY,
      useClass: MongoNotificationDeliveryRepository,
    },
    {
      provide: NOTIFICATION_GROUP_MEMBERSHIP,
      useClass: GroupsFacadeNotificationMembership,
    },
    {
      provide: VAPID_CONFIG,
      inject: [APP_CONFIG],
      useFactory: vapidFromConfig,
    },
    GetNotificationPreferences,
    UpdateNotificationPreferences,
    RegisterPushSubscription,
    DeletePushSubscription,
    GetVapidPublicKey,
  ],
  exports: [
    NOTIFICATION_PREFERENCES_REPOSITORY,
    PUSH_SUBSCRIPTION_REPOSITORY,
    NOTIFICATION_DELIVERY_REPOSITORY,
  ],
})
export class NotificationsModule {}
