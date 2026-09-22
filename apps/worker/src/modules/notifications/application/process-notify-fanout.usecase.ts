import {
  APPLICATION_STALE_EVENT_TYPE,
  APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
  GROUP_LINK_ADDED_EVENT_TYPE,
  applicationStalePayloadSchema,
  applicationStatusNotifyPayloadSchema,
  groupLinkAddedPayloadSchema,
  type ApplicationStalePayload,
  type ApplicationStatusNotifyPayload,
  type GroupLinkAddedPayload,
  type NotificationType,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { filterRecipients, prefsOf, uniqueIds } from '../domain/fanout';
import {
  NOTIFY_CLOCK,
  NOTIFY_DELIVERY_LEDGER,
  NOTIFY_GROUP_DIRECTORY,
  NOTIFY_LINK_TITLES,
  NOTIFY_MAILER,
  NOTIFY_PREFERENCES_READER,
  NOTIFY_PUSH_SUBSCRIPTIONS,
  NOTIFY_USER_DIRECTORY,
  NOTIFY_WEB_BASE_URL,
  WEB_PUSH_SENDER,
  type Clock,
  type NotifyDeliveryKey,
  type NotifyDeliveryLedger,
  type NotifyGroupDirectory,
  type NotifyLinkTitles,
  type NotifyMailer,
  type NotifyMailTemplateId,
  type NotifyPreferencesReader,
  type NotifyPushSubscriptions,
  type NotifyUserDirectory,
  type NotifyUserProfile,
  type WebPushSender,
} from './ports/notify.ports';

export type FanOutJobData =
  | { readonly type: typeof GROUP_LINK_ADDED_EVENT_TYPE; readonly payload: GroupLinkAddedPayload }
  | {
      readonly type: typeof APPLICATION_STATUS_NOTIFY_EVENT_TYPE;
      readonly payload: ApplicationStatusNotifyPayload;
    }
  | {
      readonly type: typeof APPLICATION_STALE_EVENT_TYPE;
      readonly payload: ApplicationStalePayload;
    };

/**
 * Consumer único de fan-out (ADR-035 D2): expande destinatarios con membership actual,
 * reclama ledger y entrega email/push de forma independiente por canal.
 */
@Injectable()
export class ProcessNotifyFanOut {
  private readonly logger = new Logger(ProcessNotifyFanOut.name);

  constructor(
    @Inject(NOTIFY_PREFERENCES_READER)
    private readonly preferences: NotifyPreferencesReader,
    @Inject(NOTIFY_GROUP_DIRECTORY)
    private readonly groups: NotifyGroupDirectory,
    @Inject(NOTIFY_USER_DIRECTORY)
    private readonly users: NotifyUserDirectory,
    @Inject(NOTIFY_PUSH_SUBSCRIPTIONS)
    private readonly pushSubs: NotifyPushSubscriptions,
    @Inject(NOTIFY_DELIVERY_LEDGER)
    private readonly ledger: NotifyDeliveryLedger,
    @Inject(NOTIFY_MAILER) private readonly mailer: NotifyMailer,
    @Inject(WEB_PUSH_SENDER) private readonly push: WebPushSender,
    @Inject(NOTIFY_LINK_TITLES) private readonly links: NotifyLinkTitles,
    @Inject(NOTIFY_WEB_BASE_URL) private readonly webBaseUrl: string,
    @Inject(NOTIFY_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(job: FanOutJobData): Promise<void> {
    switch (job.type) {
      case GROUP_LINK_ADDED_EVENT_TYPE:
        await this.handleGroupLinkAdded(job.payload);
        return;
      case APPLICATION_STATUS_NOTIFY_EVENT_TYPE:
        await this.handleApplicationStatus(job.payload);
        return;
      case APPLICATION_STALE_EVENT_TYPE:
        await this.handleApplicationStale(job.payload);
        return;
    }
  }

  private async handleGroupLinkAdded(
    payload: GroupLinkAddedPayload,
  ): Promise<void> {
    const members = await this.groups.memberIdsOf(payload.groupId);
    const prefsMap = await this.loadPrefs(members);
    const recipients = filterRecipients({
      members,
      actorUserId: payload.actorUserId,
      prefsOf: (id) => prefsOf(prefsMap.get(id) ?? null),
      type: 'group_new_link',
    });
    const aggregateKey = `${payload.groupId}:${payload.linkId}`;
    const groupName = await this.groups.groupNameOf(payload.groupId);
    const linkTitle = await this.links.titleOf(payload.linkId);
    const actionUrl = `${this.webBaseUrl}/grupos/${payload.groupId}`;
    await this.deliverToMany({
      type: 'group_new_link',
      aggregateKey,
      recipients,
      templateId: 'group-new-link',
      pushTitle: 'Nuevo link en el grupo',
      pushBody: linkTitle ?? groupName ?? 'Nuevo link',
      actionUrl,
      variables: {
        ...(groupName === null ? {} : { groupName }),
        ...(linkTitle === null ? {} : { linkTitle }),
      },
    });
  }

  private async handleApplicationStatus(
    payload: ApplicationStatusNotifyPayload,
  ): Promise<void> {
    const groupIds = await this.resolveStatusGroups(payload);
    if (groupIds.length === 0) {
      return;
    }
    const memberLists = await Promise.all(
      groupIds.map((id) => this.groups.memberIdsOf(id)),
    );
    const members = uniqueIds(memberLists.flat());
    const prefsMap = await this.loadPrefs(members);
    // Si el evento no trae groupId, cada destinatario puede estar acotado por su pref.
    let recipients: string[];
    if (payload.groupId !== undefined) {
      recipients = filterRecipients({
        members,
        actorUserId: payload.actorUserId,
        prefsOf: (id) => prefsOf(prefsMap.get(id) ?? null),
        type: 'application_status_group',
      });
    } else {
      recipients = [];
      for (const userId of members) {
        const prefs = prefsOf(prefsMap.get(userId) ?? null);
        if (!prefs.applicationStatusGroup) {
          continue;
        }
        if (
          userId === payload.actorUserId &&
          prefs.notifyOwnActions === false
        ) {
          continue;
        }
        if (
          prefs.applicationStatusGroupId !== null &&
          !groupIds.includes(prefs.applicationStatusGroupId)
        ) {
          continue;
        }
        if (
          prefs.applicationStatusGroupId !== null &&
          !members.includes(userId)
        ) {
          continue;
        }
        // Preferencia acota a un grupo: solo miembros de ese grupo.
        if (prefs.applicationStatusGroupId !== null) {
          const scoped = await this.groups.memberIdsOf(
            prefs.applicationStatusGroupId,
          );
          if (!scoped.includes(userId)) {
            continue;
          }
        }
        recipients.push(userId);
      }
      recipients = uniqueIds(recipients);
    }

    // D6: statusChangedAt (no status) so reopen applied→X→applied still notifies.
    const aggregateKey = `${payload.applicationId}:${payload.statusChangedAt}:${payload.groupId ?? 'union'}`;
    const linkTitle = await this.links.titleOf(payload.linkId);
    const actionUrl = `${this.webBaseUrl}/postulaciones`;
    await this.deliverToMany({
      type: 'application_status_group',
      aggregateKey,
      recipients,
      templateId: 'application-status',
      pushTitle: 'Actualización de postulación',
      pushBody: linkTitle ?? payload.status,
      actionUrl,
      variables: {
        statusLabel: payload.status,
        ...(linkTitle === null ? {} : { linkTitle }),
      },
    });
  }

  private async handleApplicationStale(
    payload: ApplicationStalePayload,
  ): Promise<void> {
    const prefsMap = await this.loadPrefs([payload.userId]);
    const recipients = filterRecipients({
      members: [payload.userId],
      actorUserId: payload.userId,
      prefsOf: (id) => prefsOf(prefsMap.get(id) ?? null),
      type: 'application_stale',
    });
    const aggregateKey = `${payload.applicationId}:${payload.lastChangedAt}`;
    const linkTitle = await this.links.titleOf(payload.linkId);
    const actionUrl = `${this.webBaseUrl}/postulaciones`;
    await this.deliverToMany({
      type: 'application_stale',
      aggregateKey,
      recipients,
      templateId: 'application-stale',
      pushTitle: 'Postulación sin cambios',
      pushBody: linkTitle ?? 'Revisa tu postulación',
      actionUrl,
      variables: {
        ...(linkTitle === null ? {} : { linkTitle }),
      },
    });
  }

  private async resolveStatusGroups(
    payload: ApplicationStatusNotifyPayload,
  ): Promise<string[]> {
    const linkGroups = await this.groups.groupIdsOfLink(payload.linkId);
    if (payload.groupId !== undefined) {
      return linkGroups.includes(payload.groupId) ? [payload.groupId] : [];
    }
    return linkGroups;
  }

  private async loadPrefs(
    userIds: readonly string[],
  ): Promise<Map<string, Awaited<ReturnType<NotifyPreferencesReader['findByUserId']>>>> {
    const map = new Map<
      string,
      Awaited<ReturnType<NotifyPreferencesReader['findByUserId']>>
    >();
    await Promise.all(
      userIds.map(async (userId) => {
        map.set(userId, await this.preferences.findByUserId(userId));
      }),
    );
    return map;
  }

  private async deliverToMany(params: {
    readonly type: NotificationType;
    readonly aggregateKey: string;
    readonly recipients: readonly string[];
    readonly templateId: NotifyMailTemplateId;
    readonly pushTitle: string;
    readonly pushBody: string;
    readonly actionUrl: string;
    readonly variables: {
      readonly groupName?: string;
      readonly linkTitle?: string;
      readonly statusLabel?: string;
    };
  }): Promise<void> {
    if (params.recipients.length === 0) {
      return;
    }
    const profiles = await this.users.profilesOf(params.recipients);
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const now = this.clock.now();
    for (const userId of params.recipients) {
      const profile = byId.get(userId);
      if (profile === undefined) {
        continue;
      }
      await this.deliverChannel({
        key: {
          type: params.type,
          aggregateKey: params.aggregateKey,
          userId,
          channel: 'email',
        },
        now,
        run: async () => {
          if (!profile.emailVerified) {
            return;
          }
          await this.mailer.send({
            to: profile.email,
            templateId: params.templateId,
            locale: profile.outputLanguage,
            variables: {
              displayName: profile.displayName,
              actionUrl: params.actionUrl,
              ...params.variables,
            },
          });
        },
      });
      await this.deliverChannel({
        key: {
          type: params.type,
          aggregateKey: params.aggregateKey,
          userId,
          channel: 'push',
        },
        now,
        run: async () => {
          const subs = await this.pushSubs.listByUserId(userId);
          if (subs.length === 0) {
            return;
          }
          for (const sub of subs) {
            await this.push.send(sub, {
              title: params.pushTitle,
              body: params.pushBody,
              url: params.actionUrl,
            });
          }
        },
      });
    }
  }

  private async deliverChannel(params: {
    readonly key: NotifyDeliveryKey;
    readonly now: Date;
    readonly run: () => Promise<void>;
  }): Promise<void> {
    const claim = await this.ledger.claim(params.key, params.now);
    if (claim === 'already_done' || claim === 'in_flight') {
      return;
    }
    try {
      await params.run();
      await this.ledger.markCompleted(params.key, this.clock.now());
    } catch (error: unknown) {
      this.logger.warn(
        `notify ${params.key.channel} failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      await this.ledger.markFailed(params.key, this.clock.now());
    }
  }
}

export function parseFanOutJob(data: unknown): FanOutJobData {
  if (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'payload' in data
  ) {
    const typed = data as { type: string; payload: unknown };
    if (typed.type === GROUP_LINK_ADDED_EVENT_TYPE) {
      return {
        type: GROUP_LINK_ADDED_EVENT_TYPE,
        payload: groupLinkAddedPayloadSchema.parse(typed.payload),
      };
    }
    if (typed.type === APPLICATION_STATUS_NOTIFY_EVENT_TYPE) {
      return {
        type: APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
        payload: applicationStatusNotifyPayloadSchema.parse(typed.payload),
      };
    }
    if (typed.type === APPLICATION_STALE_EVENT_TYPE) {
      return {
        type: APPLICATION_STALE_EVENT_TYPE,
        payload: applicationStalePayloadSchema.parse(typed.payload),
      };
    }
  }
  // Relay publica el payload plano (sin wrapper type). Detectar por forma.
  const asGroup = groupLinkAddedPayloadSchema.safeParse(data);
  if (asGroup.success) {
    return { type: GROUP_LINK_ADDED_EVENT_TYPE, payload: asGroup.data };
  }
  const asStatus = applicationStatusNotifyPayloadSchema.safeParse(data);
  if (asStatus.success) {
    return {
      type: APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
      payload: asStatus.data,
    };
  }
  const asStale = applicationStalePayloadSchema.safeParse(data);
  if (asStale.success) {
    return { type: APPLICATION_STALE_EVENT_TYPE, payload: asStale.data };
  }
  throw new Error('Unknown notify fan-out job payload');
}

// Silencia unused import warning for NotifyUserProfile in some tsc configs.
export type { NotifyUserProfile };
