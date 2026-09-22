import {
  type DynamicModule,
  Module,
  type OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { DetectStaleApplications } from './application/detect-stale-applications.usecase';
import {
  APPLICATION_STALE_CLAIMS,
  NOTIFY_CLOCK,
  NOTIFY_DELIVERY_LEDGER,
  NOTIFY_FANOUT_QUEUE_PUBLISHER,
  NOTIFY_GROUP_DIRECTORY,
  NOTIFY_LINK_TITLES,
  NOTIFY_MAILER,
  NOTIFY_PREFERENCES_READER,
  NOTIFY_PUSH_SUBSCRIPTIONS,
  NOTIFY_USER_DIRECTORY,
  NOTIFY_WEB_BASE_URL,
  WEB_PUSH_SENDER,
} from './application/ports/notify.ports';
import { ProcessNotifyFanOut } from './application/process-notify-fanout.usecase';
import {
  CapturingNotifyMailer,
  SmtpOrResendNotifyMailer,
} from './infrastructure/mail/notify-mailer';
import {
  MongoApplicationStaleClaims,
  MongoNotifyDeliveryLedger,
  MongoNotifyGroupDirectory,
  MongoNotifyLinkTitles,
  MongoNotifyPreferencesReader,
  MongoNotifyPushSubscriptions,
  MongoNotifyUserDirectory,
} from './infrastructure/persistence/mongo-notify.adapters';
import {
  WORKER_VAPID_KEYS,
  WebPushVapidSender,
} from './infrastructure/push/web-push-sender';
import {
  BullmqNotifyFanoutPublisher,
  NOTIFY_FANOUT_QUEUE_TOKEN,
  createNotifyFanoutQueue,
} from './infrastructure/queue/bullmq-notify-publisher';
import { NotifyFanOutConsumer } from './infrastructure/queue/notify-fanout.consumer';
import { StaleApplicationsScheduler } from './infrastructure/queue/stale-applications.scheduler';

class SystemClock {
  now(): Date {
    return new Date();
  }
}

class NotifyQueueCloser implements OnModuleDestroy {
  constructor(private readonly queue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Módulo notifications del worker (ADR-035): fan-out consumer + detector stale.
 * En `NODE_ENV=test` no registra Worker BullMQ ni cron (igual que enrichment/match).
 */
@Module({})
export class NotificationsModule {
  static register(config: WorkerConfig): DynamicModule {
    const consumersEnabled = config.NODE_ENV !== 'test';
    const mailTransport =
      config.MAIL_PROVIDER === 'smtp'
        ? 'smtp'
        : config.MAIL_PROVIDER === 'resend'
          ? 'resend'
          : 'capture';

    const shared: Provider[] = [
      { provide: NOTIFY_CLOCK, useClass: SystemClock },
      { provide: NOTIFY_WEB_BASE_URL, useValue: config.WEB_BASE_URL },
      {
        provide: NOTIFY_PREFERENCES_READER,
        useClass: MongoNotifyPreferencesReader,
      },
      {
        provide: NOTIFY_GROUP_DIRECTORY,
        useClass: MongoNotifyGroupDirectory,
      },
      { provide: NOTIFY_USER_DIRECTORY, useClass: MongoNotifyUserDirectory },
      {
        provide: NOTIFY_PUSH_SUBSCRIPTIONS,
        useClass: MongoNotifyPushSubscriptions,
      },
      {
        provide: NOTIFY_DELIVERY_LEDGER,
        useClass: MongoNotifyDeliveryLedger,
      },
      { provide: NOTIFY_LINK_TITLES, useClass: MongoNotifyLinkTitles },
      {
        provide: APPLICATION_STALE_CLAIMS,
        useClass: MongoApplicationStaleClaims,
      },
      {
        provide: WORKER_VAPID_KEYS,
        useValue: {
          publicKey: config.VAPID_PUBLIC_KEY || null,
          privateKey: config.VAPID_PRIVATE_KEY || null,
          subject: config.VAPID_SUBJECT || null,
        },
      },
      { provide: WEB_PUSH_SENDER, useClass: WebPushVapidSender },
      {
        provide: NOTIFY_MAILER,
        useFactory: () => {
          if (mailTransport === 'capture') {
            return new CapturingNotifyMailer();
          }
          return new SmtpOrResendNotifyMailer(
            config.MAIL_FROM,
            mailTransport,
            {
              host: config.MAIL_SMTP_HOST ?? 'localhost',
              port: config.MAIL_SMTP_PORT ?? 1025,
            },
            config.RESEND_API_KEY,
          );
        },
      },
      ProcessNotifyFanOut,
      DetectStaleApplications,
    ];

    const queueProviders: Provider[] = consumersEnabled
      ? [
          {
            provide: NOTIFY_FANOUT_QUEUE_TOKEN,
            useFactory: () => createNotifyFanoutQueue(config.REDIS_URL),
          },
          {
            provide: NOTIFY_FANOUT_QUEUE_PUBLISHER,
            useClass: BullmqNotifyFanoutPublisher,
          },
          {
            provide: NotifyFanOutConsumer,
            useFactory: (useCase: ProcessNotifyFanOut) =>
              new NotifyFanOutConsumer(useCase, config.REDIS_URL),
            inject: [ProcessNotifyFanOut],
          },
          StaleApplicationsScheduler,
          {
            provide: NotifyQueueCloser,
            inject: [NOTIFY_FANOUT_QUEUE_TOKEN],
            useFactory: (queue: Queue) => new NotifyQueueCloser(queue),
          },
        ]
      : [
          {
            provide: NOTIFY_FANOUT_QUEUE_PUBLISHER,
            useValue: {
              add: async () => {
                /* tests: no Redis */
              },
            },
          },
        ];

    return {
      module: NotificationsModule,
      imports: consumersEnabled ? [ScheduleModule.forRoot()] : [],
      providers: [...shared, ...queueProviders],
    };
  }
}
