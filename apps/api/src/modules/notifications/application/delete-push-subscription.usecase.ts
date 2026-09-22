import { Inject, Injectable } from '@nestjs/common';
import {
  PUSH_SUBSCRIPTION_REPOSITORY,
  type PushSubscriptionRepository,
} from './ports/push-subscription.repository.port';

@Injectable()
export class DeletePushSubscription {
  constructor(
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: PushSubscriptionRepository,
  ) {}

  async execute(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.deleteByEndpoint(userId, endpoint);
  }
}
