import type { PushSubscriptionRequest } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { NOTIFICATIONS_CLOCK, type Clock } from './ports/clock.port';
import {
  PUSH_SUBSCRIPTION_REPOSITORY,
  type PushSubscriptionRepository,
} from './ports/push-subscription.repository.port';

export interface RegisterPushResult {
  readonly created: boolean;
}

@Injectable()
export class RegisterPushSubscription {
  constructor(
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: PushSubscriptionRepository,
    @Inject(NOTIFICATIONS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    request: PushSubscriptionRequest,
  ): Promise<RegisterPushResult> {
    const result = await this.subscriptions.upsert({
      userId,
      endpoint: request.endpoint,
      p256dh: request.keys.p256dh,
      auth: request.keys.auth,
      createdAt: this.clock.now(),
    });
    return { created: result.created };
  }
}
