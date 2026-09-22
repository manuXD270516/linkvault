import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';

export const NOTIFICATION_DELIVERY_REPOSITORY = Symbol(
  'NOTIFICATION_DELIVERY_REPOSITORY',
);

export type NotificationChannel = 'email' | 'push';

export type DeliveryStatus = 'claimed' | 'completed' | 'failed';

/** Clave durable de una entrega (ADR-035 D6). */
export interface DeliveryKey {
  readonly type: string;
  readonly aggregateKey: string;
  readonly userId: string;
  readonly channel: NotificationChannel;
}

export interface NotificationDeliveryRepository {
  /**
   * Inserta/reclama la entrega. `claimed` = esta corrida debe enviar;
   * `completed`/`failed` = no reenviar; `null` si otra corrida tiene claim vivo.
   */
  claim(
    key: DeliveryKey,
    now: Date,
  ): Promise<DeliveryStatus | 'already_done' | 'in_flight'>;

  markCompleted(key: DeliveryKey, now: Date): Promise<void>;

  markFailed(key: DeliveryKey, now: Date): Promise<void>;

  deleteByUserId(
    userId: string,
    session?: TransactionSession,
  ): Promise<void>;
}
