import type {
  ClosedReason,
  Platform,
  PreviewStatus,
  StoredPreview,
} from '@linkvault/shared';

export const FRESHNESS_LINK_STORE = Symbol('FRESHNESS_LINK_STORE');
export const FRESHNESS_LINK_CLAIMS = Symbol('FRESHNESS_LINK_CLAIMS');
export const FRESHNESS_CLOCK = Symbol('FRESHNESS_CLOCK');
export const FRESHNESS_ENRICHMENT_NOTIFIER = Symbol(
  'FRESHNESS_ENRICHMENT_NOTIFIER',
);
export const ENRICH_LINK_QUEUE_PUBLISHER = Symbol('ENRICH_LINK_QUEUE_PUBLISHER');
export const EXPIRE_APPLICATIONS_FOR_CLOSED_LINK = Symbol(
  'EXPIRE_APPLICATIONS_FOR_CLOSED_LINK',
);
export const CLOSED_LINK_APPLICATIONS = Symbol('CLOSED_LINK_APPLICATIONS');
export const STATUS_GROUP_NOTIFY_CLAIMS = Symbol('STATUS_GROUP_NOTIFY_CLAIMS');
export const FRESHNESS_NOTIFY_QUEUE = Symbol('FRESHNESS_NOTIFY_QUEUE');
export const CLOSE_JOB_LINK = Symbol('CLOSE_JOB_LINK');

export interface FreshnessClock {
  now(): Date;
}

/** Link candidato a frescura / cascada. */
export interface FreshnessLinkRow {
  readonly linkId: string;
  readonly previewStatus: PreviewStatus;
  readonly previewVersion: number;
  readonly preview: StoredPreview;
  readonly platform: Platform;
  readonly displayUrl: string;
  readonly closedAt?: Date;
  readonly closedReason?: ClosedReason;
  readonly lastFreshnessCheckAt?: Date;
  readonly previewRequestedAt?: Date;
  readonly updatedAt: Date;
}

export interface FreshnessLinkStore {
  /**
   * Selector 1: no cerrado, preview usable, cadencia vencida **o** expiresAt < hoy UTC.
   */
  listOpenEligible(input: {
    readonly now: Date;
    readonly intervalDays: number;
    readonly limit: number;
  }): Promise<FreshnessLinkRow[]>;

  /**
   * Selector 2: ya cerrado con apps abiertas **o** group expired sin ASN confirmado.
   */
  listCascadePending(input: {
    readonly limit: number;
  }): Promise<FreshnessLinkRow[]>;

  findById(linkId: string): Promise<FreshnessLinkRow | null>;

  closeIfOpen(
    linkId: string,
    write: {
      readonly closedAt: Date;
      readonly closedReason: ClosedReason;
      readonly lastFreshnessCheckAt: Date;
    },
  ): Promise<boolean>;

  touchFreshnessCheck(linkId: string, at: Date): Promise<void>;
}

export interface FreshnessLinkClaims {
  /**
   * Reclama con lease. `true` si esta corrida debe procesar el link.
   * Si el encolado / efecto falla, liberar con `release`.
   */
  claim(linkId: string, now: Date, leaseMs: number): Promise<boolean>;
  release(linkId: string): Promise<void>;
  confirm(linkId: string): Promise<void>;
}

export interface EnrichLinkQueuePublisher {
  add(job: {
    readonly data: {
      readonly linkId: string;
      readonly previewVersion: number;
      readonly triggeredBy: 'freshness';
    };
    readonly jobId: string;
  }): Promise<void>;
}

export interface ClosedLinkApplicationRow {
  readonly applicationId: string;
  readonly userId: string;
  readonly linkId: string;
  readonly status: string;
  readonly visibility: 'private' | 'group';
  readonly statusChangedAt: Date;
  readonly version: number;
  readonly stageLabel?: string;
}

export interface ClosedLinkApplications {
  /** Abiertas + group ya expired con notify aún reclamable. */
  listForExpireCascade(linkId: string): Promise<ClosedLinkApplicationRow[]>;

  /**
   * Transición atómica a `expired` solo si sigue abierta. Devuelve la fila resultante
   * (o null si no cambió: ya cerrada / carrera perdida).
   */
  expireIfOpen(
    applicationId: string,
    now: Date,
  ): Promise<ClosedLinkApplicationRow | null>;
}

export interface StatusGroupNotifyClaims {
  claim(
    applicationId: string,
    statusChangedAt: Date,
    now: Date,
    leaseMs: number,
  ): Promise<boolean>;
  release(applicationId: string, statusChangedAt: Date): Promise<void>;
  confirm(applicationId: string, statusChangedAt: Date): Promise<void>;
  /** Sin claim confirmado (ni lease vivo): elegible de nuevo tras release. */
  isConfirmed(applicationId: string, statusChangedAt: Date): Promise<boolean>;
}

export interface FreshnessNotifyQueuePublisher {
  add(job: {
    readonly name: string;
    readonly data: Record<string, unknown>;
    readonly jobId: string;
  }): Promise<void>;
}

export interface ExpireApplicationsForClosedLink {
  execute(linkId: string): Promise<{ readonly expired: number; readonly notified: number }>;
}

export interface CloseJobLink {
  execute(input: {
    readonly linkId: string;
    readonly reason: ClosedReason;
  }): Promise<{ readonly closed: boolean; readonly alreadyClosed: boolean }>;
}
