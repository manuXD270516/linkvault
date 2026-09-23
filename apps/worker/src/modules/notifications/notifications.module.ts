import {
  type DynamicModule,
  Injectable,
  Module,
  type OnModuleDestroy,
  type Provider,
  type Type,
} from '@nestjs/common';
import { Cron, ScheduleModule } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { DetectStaleApplications } from './application/detect-stale-applications.usecase';
import {
  APPLICATION_STALE_CLAIMS,
  GROUP_DIGEST_CATALOG,
  GROUP_DIGEST_ENABLED,
  GROUP_DIGEST_QUEUE_PUBLISHER,
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
import { ProcessGroupWeeklyDigest } from './application/process-group-weekly-digest.usecase';
import { ProcessNotifyFanOut } from './application/process-notify-fanout.usecase';
import {
  CapturingNotifyMailer,
  SmtpOrResendNotifyMailer,
} from './infrastructure/mail/notify-mailer';
import { MongoGroupDigestCatalog } from './infrastructure/persistence/mongo-group-digest.catalog';
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
  BullmqGroupDigestPublisher,
  GROUP_DIGEST_QUEUE_TOKEN,
  createGroupDigestQueue,
} from './infrastructure/queue/bullmq-group-digest-publisher';
import {
  BullmqNotifyFanoutPublisher,
  NOTIFY_FANOUT_QUEUE_TOKEN,
  createNotifyFanoutQueue,
} from './infrastructure/queue/bullmq-notify-publisher';
import { GroupDigestConsumer } from './infrastructure/queue/group-digest.consumer';
import { GroupDigestScheduler } from './infrastructure/queue/group-digest.scheduler';
import { NotifyFanOutConsumer } from './infrastructure/queue/notify-fanout.consumer';
import { StaleApplicationsScheduler } from './infrastructure/queue/stale-applications.scheduler';

class SystemClock {
  now(): Date {
    return new Date();
  }
}

class NotifyQueueCloser implements OnModuleDestroy {
  constructor(
    private readonly fanout: Queue | null,
    private readonly digest: Queue | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.fanout?.close();
    await this.digest?.close();
  }
}

/**
 * Host `@Cron` dinámico: la expresión viene de `GROUP_DIGEST_CRON` al registrar el módulo.
 */
function createGroupDigestCronHost(cronExpr: string): Type<unknown> {
  @Injectable()
  class GroupDigestCronHost {
    constructor(private readonly scheduler: GroupDigestScheduler) {}

    @Cron(cronExpr, { timeZone: 'UTC' })
    handle(): Promise<void> {
      return this.scheduler.tick();
    }
  }
  return GroupDigestCronHost;
}

/**
 * Módulo notifications del worker (ADR-035 + digest B10): fan-out, stale y digest.
 * En `NODE_ENV=test` no registra Worker BullMQ ni cron.
 */
@Module({})
export class NotificationsModule {
  static register(config: WorkerConfig): DynamicModule {
    const consumersEnabled = config.NODE_ENV !== 'test';
    const digestEnabled = config.FEATURE_GROUP_DIGEST && consumersEnabled;
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
        provide: GROUP_DIGEST_ENABLED,
        useValue: config.FEATURE_GROUP_DIGEST,
      },
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
        provide: GROUP_DIGEST_CATALOG,
        useClass: MongoGroupDigestCatalog,
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
      ProcessGroupWeeklyDigest,
      GroupDigestScheduler,
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
          ...(digestEnabled
            ? ([
                {
                  provide: GROUP_DIGEST_QUEUE_TOKEN,
                  useFactory: () => createGroupDigestQueue(config.REDIS_URL),
                },
                {
                  provide: GROUP_DIGEST_QUEUE_PUBLISHER,
                  useClass: BullmqGroupDigestPublisher,
                },
                {
                  provide: GroupDigestConsumer,
                  useFactory: (useCase: ProcessGroupWeeklyDigest) =>
                    new GroupDigestConsumer(useCase, config.REDIS_URL),
                  inject: [ProcessGroupWeeklyDigest],
                },
                createGroupDigestCronHost(config.GROUP_DIGEST_CRON),
              ] as Provider[])
            : ([
                {
                  provide: GROUP_DIGEST_QUEUE_TOKEN,
                  useValue: null,
                },
                {
                  provide: GROUP_DIGEST_QUEUE_PUBLISHER,
                  useValue: {
                    add: async () => {
                      /* FEATURE_GROUP_DIGEST off */
                    },
                  },
                },
              ] as Provider[])),
          {
            provide: NotifyQueueCloser,
            inject: [NOTIFY_FANOUT_QUEUE_TOKEN, GROUP_DIGEST_QUEUE_TOKEN],
            useFactory: (fanout: Queue, digest: Queue | null) =>
              new NotifyQueueCloser(fanout, digest),
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
          {
            provide: GROUP_DIGEST_QUEUE_PUBLISHER,
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
