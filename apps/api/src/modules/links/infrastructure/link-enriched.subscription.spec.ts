import type { LinkEnrichedPayload } from '@linkvault/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DeliverLinkEnriched } from '../application/deliver-link-enriched.usecase';
import type { EnrichmentNotices } from '../application/ports/enrichment-notices.port';
import { LinkEnrichedSubscription } from './link-enriched.subscription';

// La suscripción única por proceso (tarea 6.7). Sin Redis: el canal es un doble.

/** Canal doble que deja disparar avisos y cuenta cuántas veces se le pidió escuchar. */
class NoticesDouble implements EnrichmentNotices {
  subscriptions = 0;
  unsubscriptions = 0;
  private handler:
    | ((payload: LinkEnrichedPayload) => Promise<void>)
    | undefined;

  constructor(private readonly failOnSubscribe = false) {}

  subscribe(
    handler: (payload: LinkEnrichedPayload) => Promise<void>,
  ): Promise<() => Promise<void>> {
    if (this.failOnSubscribe) {
      return Promise.reject(new Error('redis is not there'));
    }
    this.subscriptions += 1;
    this.handler = handler;
    return Promise.resolve(() => {
      this.unsubscriptions += 1;
      this.handler = undefined;
      return Promise.resolve();
    });
  }

  async publish(payload: LinkEnrichedPayload): Promise<void> {
    await this.handler?.(payload);
  }
}

const notice: LinkEnrichedPayload = {
  linkId: '000000000000000000000007',
  previewStatus: 'enriched',
  previewVersion: 2,
};

function deliverDouble(): DeliverLinkEnriched {
  return { execute: vi.fn().mockResolvedValue(1) } as unknown as
    DeliverLinkEnriched;
}

describe('LinkEnrichedSubscription', () => {
  it('listens once per process and hands the notice to the delivery', async () => {
    const notices = new NoticesDouble();
    const deliver = deliverDouble();
    const subscription = new LinkEnrichedSubscription(notices, deliver);

    await subscription.onModuleInit();
    await notices.publish(notice);

    expect(notices.subscriptions).toBe(1);
    expect(deliver.execute).toHaveBeenCalledWith(notice);
  });

  it('stops listening when the process shuts down', async () => {
    const notices = new NoticesDouble();
    const subscription = new LinkEnrichedSubscription(notices, deliverDouble());
    await subscription.onModuleInit();

    await subscription.onApplicationShutdown();
    await subscription.onApplicationShutdown();

    // Apagar dos veces no vuelve a darse de baja: Nest puede llamar al hook más de una vez.
    expect(notices.unsubscriptions).toBe(1);
  });

  it('does not bring the process down when the channel is not there', async () => {
    const subscription = new LinkEnrichedSubscription(
      new NoticesDouble(true),
      deliverDouble(),
    );

    await expect(subscription.onModuleInit()).resolves.toBeUndefined();
    await expect(
      subscription.onApplicationShutdown(),
    ).resolves.toBeUndefined();
  });
});
