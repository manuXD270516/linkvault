import type { NotificationPreferences } from '@linkvault/shared';

export const NOTIFY_PREFERENCES_READER = Symbol('NOTIFY_PREFERENCES_READER');

export interface NotifyPreferencesReader {
  findByUserId(userId: string): Promise<NotificationPreferences | null>;
}

export const NOTIFY_GROUP_DIRECTORY = Symbol('NOTIFY_GROUP_DIRECTORY');

export interface NotifyGroupDirectory {
  memberIdsOf(groupId: string): Promise<string[]>;
  /** Grupos donde está el link (ids). */
  groupIdsOfLink(linkId: string): Promise<string[]>;
  groupNameOf(groupId: string): Promise<string | null>;
}

export const NOTIFY_USER_DIRECTORY = Symbol('NOTIFY_USER_DIRECTORY');

export interface NotifyUserProfile {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly emailVerified: boolean;
  readonly outputLanguage: 'es' | 'en';
}

export interface NotifyUserDirectory {
  profilesOf(userIds: readonly string[]): Promise<NotifyUserProfile[]>;
}

export const NOTIFY_PUSH_SUBSCRIPTIONS = Symbol('NOTIFY_PUSH_SUBSCRIPTIONS');

export interface NotifyPushSubscription {
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface NotifyPushSubscriptions {
  listByUserId(userId: string): Promise<readonly NotifyPushSubscription[]>;
  deleteEndpoint(endpoint: string): Promise<void>;
}

export const NOTIFY_DELIVERY_LEDGER = Symbol('NOTIFY_DELIVERY_LEDGER');

export type NotifyChannel = 'email' | 'push';

export interface NotifyDeliveryKey {
  readonly type: string;
  readonly aggregateKey: string;
  readonly userId: string;
  readonly channel: NotifyChannel;
}

export interface NotifyDeliveryLedger {
  claim(
    key: NotifyDeliveryKey,
    now: Date,
  ): Promise<'claimed' | 'already_done' | 'in_flight'>;
  markCompleted(key: NotifyDeliveryKey, now: Date): Promise<void>;
  markFailed(key: NotifyDeliveryKey, now: Date): Promise<void>;
}

export const NOTIFY_MAILER = Symbol('NOTIFY_MAILER');

export type NotifyMailTemplateId =
  | 'group-new-link'
  | 'application-status'
  | 'application-stale';

export interface NotifyMailMessage {
  readonly to: string;
  readonly templateId: NotifyMailTemplateId;
  readonly locale: 'es' | 'en';
  readonly variables: {
    readonly displayName: string;
    readonly actionUrl: string;
    readonly groupName?: string;
    readonly linkTitle?: string;
    readonly statusLabel?: string;
  };
}

export interface NotifyMailer {
  send(message: NotifyMailMessage): Promise<void>;
}

export const WEB_PUSH_SENDER = Symbol('WEB_PUSH_SENDER');

export interface WebPushPayload {
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

export interface WebPushSender {
  /**
   * Envía push. Si el endpoint responde 410/404, elimina esa suscripción.
   * Sin VAPID configurado: no-op (fail-soft).
   */
  send(
    subscription: NotifyPushSubscription,
    payload: WebPushPayload,
  ): Promise<void>;
}

export const NOTIFY_LINK_TITLES = Symbol('NOTIFY_LINK_TITLES');

export interface NotifyLinkTitles {
  titleOf(linkId: string): Promise<string | null>;
}

export const NOTIFY_CLOCK = Symbol('NOTIFY_CLOCK');

export interface Clock {
  now(): Date;
}

export const NOTIFY_WEB_BASE_URL = Symbol('NOTIFY_WEB_BASE_URL');

export const APPLICATION_STALE_CLAIMS = Symbol('APPLICATION_STALE_CLAIMS');

export interface StaleApplicationRow {
  readonly applicationId: string;
  readonly userId: string;
  readonly linkId: string;
  readonly status: string;
  readonly statusChangedAt: Date;
}

export interface ApplicationStaleClaims {
  /** Elegibles: !closed, statusChangedAt <= threshold, sin claim vivo. */
  listEligible(threshold: Date, limit: number): Promise<StaleApplicationRow[]>;
  /**
   * Reclama con lease. `true` si esta corrida debe encolar.
   * Si `Queue.add` falla, liberar con `release`.
   */
  claim(
    applicationId: string,
    statusChangedAt: Date,
    now: Date,
    leaseMs: number,
  ): Promise<boolean>;
  release(applicationId: string, statusChangedAt: Date): Promise<void>;
  /** Confirma claim tras encolar con éxito (marca dura hasta nuevo statusChangedAt). */
  confirm(applicationId: string, statusChangedAt: Date): Promise<void>;
}

export const NOTIFY_FANOUT_QUEUE_PUBLISHER = Symbol(
  'NOTIFY_FANOUT_QUEUE_PUBLISHER',
);

export interface NotifyFanoutQueuePublisher {
  add(job: {
    readonly name: string;
    readonly data: Record<string, unknown>;
    readonly jobId: string;
  }): Promise<void>;
}
