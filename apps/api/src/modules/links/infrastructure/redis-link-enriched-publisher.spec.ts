import {
  LINK_ENRICHED_CHANNEL,
  linkEnrichedEventSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  RedisLinkEnrichedPublisher,
  type LinkEnrichedPublisherClient,
} from './redis-link-enriched-publisher';

// Adaptador LINK_ENRICHED_PUBLISHER (tarea 6.4 de paste-job-description) con un doble del cliente: la suite de `api` no
// tiene Redis (ADR-021 §4).

const PAYLOAD = {
  linkId: '000000000000000000000007',
  previewStatus: 'enriched',
  previewVersion: 4,
} as const;

class ClientDouble implements LinkEnrichedPublisherClient {
  readonly published: { channel: string; message: string }[] = [];
  down = false;

  publish(channel: string, message: string): Promise<unknown> {
    if (this.down) {
      return Promise.reject(new Error('Connection is closed.'));
    }
    this.published.push({ channel, message });
    return Promise.resolve(1);
  }
}

class LoggerDouble {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

describe('RedisLinkEnrichedPublisher', () => {
  it('publishes the notice on the channel the worker uses, in the contract api reads', async () => {
    const client = new ClientDouble();

    await new RedisLinkEnrichedPublisher(client, new LoggerDouble()).publish(
      PAYLOAD,
    );

    expect(client.published).toHaveLength(1);
    expect(client.published[0]?.channel).toBe(LINK_ENRICHED_CHANNEL);
    expect(
      linkEnrichedEventSchema.parse(
        JSON.parse(client.published[0]?.message ?? ''),
      ).payload,
    ).toEqual(PAYLOAD);
  });

  it('does not throw with Redis down, and says so once per streak', async () => {
    const client = new ClientDouble();
    client.down = true;
    const logger = new LoggerDouble();
    const publisher = new RedisLinkEnrichedPublisher(client, logger);

    await expect(publisher.publish(PAYLOAD)).resolves.toBeUndefined();
    await expect(publisher.publish(PAYLOAD)).resolves.toBeUndefined();

    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).not.toContain(PAYLOAD.linkId);
  });
});
