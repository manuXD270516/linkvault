import type {
  NewPushSubscription,
  PushSubscription,
} from '../../domain/push-subscription';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';

export const PUSH_SUBSCRIPTION_REPOSITORY = Symbol(
  'PUSH_SUBSCRIPTION_REPOSITORY',
);

export interface UpsertPushResult {
  readonly subscription: PushSubscription;
  /** `true` si la fila era nueva. */
  readonly created: boolean;
}

export interface PushSubscriptionRepository {
  upsert(input: NewPushSubscription): Promise<UpsertPushResult>;

  /** Idempotente: no falla si no existía. */
  deleteByEndpoint(userId: string, endpoint: string): Promise<void>;

  listByUserId(userId: string): Promise<readonly PushSubscription[]>;

  deleteByUserId(
    userId: string,
    session?: TransactionSession,
  ): Promise<void>;

  /** Purge tras 410/404 del push (solo ese endpoint). */
  deleteEndpoint(endpoint: string): Promise<void>;
}
