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
  | 'application-stale'
  | 'group-weekly-digest';

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
    /** Digest: títulos (máx 10) ya ordenados. */
    readonly linkTitles?: readonly string[];
    /** Digest: cuántos quedan tras el tope. */
    readonly moreCount?: number;
    /** Digest: URL a preferencias de notificación. */
    readonly preferencesUrl?: string;
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

export const GROUP_DIGEST_CATALOG = Symbol('GROUP_DIGEST_CATALOG');

export interface DigestGroupPage {
  readonly groupIds: readonly string[];
  /** Cursor para la siguiente página (`_id` hex); null si no hay más. */
  readonly nextCursor: string | null;
}

export interface DigestWindowLink {
  readonly linkId: string;
  readonly sharedAt: Date;
  readonly title: string | null;
}

/**
 * Catálogo del digest: listado paginado de grupos + links con sharedAt en ventana.
 * La proyección NO incluye `note` de group_links.
 */
export interface GroupDigestCatalog {
  listGroupIds(params: {
    readonly afterId: string | null;
    readonly limit: number;
  }): Promise<DigestGroupPage>;
  /**
   * Links del grupo con sharedAt ∈ [windowStart, windowEnd), sharedAt desc.
   * `limit` acota filas leídas (típicamente maxTitles+1 o un tope alto para moreCount).
   */
  listLinksInWindow(params: {
    readonly groupId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
    readonly limit: number;
  }): Promise<readonly DigestWindowLink[]>;
  /** Conteo exacto en ventana (para “y K más” si limit truncó). */
  countLinksInWindow(params: {
    readonly groupId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
  }): Promise<number>;
}

export const GROUP_DIGEST_QUEUE_PUBLISHER = Symbol(
  'GROUP_DIGEST_QUEUE_PUBLISHER',
);

export interface GroupDigestQueuePublisher {
  add(job: {
    readonly name: string;
    readonly data: { readonly weekKey: string };
    readonly jobId: string;
  }): Promise<void>;
}

export const GROUP_DIGEST_ENABLED = Symbol('GROUP_DIGEST_ENABLED');

