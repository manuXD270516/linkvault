import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import type {
  NotifyPushSubscription,
  WebPushPayload,
  WebPushSender,
} from '../../application/ports/notify.ports';
import {
  NOTIFY_PUSH_SUBSCRIPTIONS,
  type NotifyPushSubscriptions,
} from '../../application/ports/notify.ports';

export interface VapidKeys {
  readonly publicKey: string | null;
  readonly privateKey: string | null;
  readonly subject: string | null;
}

export const WORKER_VAPID_KEYS = Symbol('WORKER_VAPID_KEYS');

@Injectable()
export class WebPushVapidSender implements WebPushSender {
  private readonly logger = new Logger(WebPushVapidSender.name);
  private readonly configured: boolean;

  constructor(
    @Inject(WORKER_VAPID_KEYS) private readonly vapid: VapidKeys,
    @Inject(NOTIFY_PUSH_SUBSCRIPTIONS)
    private readonly subscriptions: NotifyPushSubscriptions,
  ) {
    const pub = vapid.publicKey?.trim() ?? '';
    const priv = vapid.privateKey?.trim() ?? '';
    const subject = vapid.subject?.trim() ?? '';
    this.configured = pub !== '' && priv !== '' && subject !== '';
    if (this.configured) {
      webpush.setVapidDetails(subject, pub, priv);
    } else {
      this.logger.warn('VAPID keys missing; web push disabled (email still works)');
    }
  }

  async send(
    subscription: NotifyPushSubscription,
    payload: WebPushPayload,
  ): Promise<void> {
    if (!this.configured) {
      return;
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
    } catch (error: unknown) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof (error as { statusCode: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : undefined;
      if (status === 410 || status === 404) {
        await this.subscriptions.deleteEndpoint(subscription.endpoint);
        return;
      }
      throw error;
    }
  }
}

/** Doble de tests: registra envíos y puede simular 410. */
export class RecordingWebPushSender implements WebPushSender {
  readonly sent: { endpoint: string; payload: WebPushPayload }[] = [];
  goneEndpoints = new Set<string>();

  constructor(
    private readonly onGone?: (endpoint: string) => Promise<void>,
  ) {}

  async send(
    subscription: NotifyPushSubscription,
    payload: WebPushPayload,
  ): Promise<void> {
    if (this.goneEndpoints.has(subscription.endpoint)) {
      await this.onGone?.(subscription.endpoint);
      return;
    }
    this.sent.push({ endpoint: subscription.endpoint, payload });
  }
}
