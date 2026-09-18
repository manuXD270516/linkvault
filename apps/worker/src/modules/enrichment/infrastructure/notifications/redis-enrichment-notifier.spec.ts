import {
  LINK_ENRICHED_CHANNEL,
  linkEnrichedEvent,
  linkEnrichedEventSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  RedisEnrichmentNotifier,
  type EnrichmentNotifierLogger,
  type EnrichmentPublisherClient,
} from './redis-enrichment-notifier';

// Requisito "Aviso de link enriquecido" (specs/platform/realtime) y D9 de link-enrichment, por el lado del worker: lo
// que se publica es exactamente lo que el suscriptor de `api` valida, y un Redis que no responde no puede tumbar un
// enriquecimiento que ya está escrito en Mongo. Ningún test abre una conexión.

/** Redis mínimo que recuerda lo publicado y cuenta los suscriptores que dice tener. */
class FakeRedis implements EnrichmentPublisherClient {
  readonly published: { channel: string; message: string }[] = [];

  constructor(private readonly receivers = 0) {}

  publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return Promise.resolve(this.receivers);
  }
}

/** Redis caído: el cliente del enriquecimiento no encola comandos sin conexión, así que el comando falla en el acto. */
class BrokenRedis implements EnrichmentPublisherClient {
  calls = 0;

  publish(): Promise<never> {
    this.calls += 1;
    return Promise.reject(new Error('Stream isn’t writeable'));
  }
}

/** Un Redis que se cae y vuelve, para probar que cada racha de fallos deja un renglón y no más. */
class FlakyRedis implements EnrichmentPublisherClient {
  down = false;

  publish(): Promise<number> {
    return this.down
      ? Promise.reject(new Error('Connection is closed'))
      : Promise.resolve(1);
  }
}

class RecordingLogger implements EnrichmentNotifierLogger {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

const event = linkEnrichedEvent({
  linkId: '68f0c0a3b1c4d5e6f7a8b9c0',
  previewStatus: 'enriched',
  previewVersion: 2,
});

describe('RedisEnrichmentNotifier', () => {
  it('publishes the notice on the channel the api subscribes to', async () => {
    const redis = new FakeRedis(1);

    await new RedisEnrichmentNotifier(redis, new RecordingLogger()).publish(
      event,
    );

    expect(redis.published).toHaveLength(1);
    expect(redis.published[0]?.channel).toBe(LINK_ENRICHED_CHANNEL);
  });

  it('publishes a message that the subscriber contract accepts', async () => {
    const redis = new FakeRedis(1);

    await new RedisEnrichmentNotifier(redis, new RecordingLogger()).publish(
      event,
    );

    // Lo mismo que hace `RedisEnrichmentNotices` al recibirlo: `JSON.parse` y el esquema, que es `strict`.
    const parsed = linkEnrichedEventSchema.safeParse(
      JSON.parse(redis.published[0]?.message ?? ''),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(event);
  });

  it('Nadie escuchando', async () => {
    const redis = new FakeRedis(0);
    const logger = new RecordingLogger();

    await expect(
      new RedisEnrichmentNotifier(redis, logger).publish(event),
    ).resolves.toBeUndefined();
    expect(logger.warnings).toEqual([]);
  });

  it('does not propagate a failure when redis is unreachable', async () => {
    const logger = new RecordingLogger();

    await expect(
      new RedisEnrichmentNotifier(new BrokenRedis(), logger).publish(event),
    ).resolves.toBeUndefined();
    expect(logger.warnings).toHaveLength(1);
  });

  it('logs one warning per outage, not one per link', async () => {
    const redis = new BrokenRedis();
    const logger = new RecordingLogger();
    const notifier = new RedisEnrichmentNotifier(redis, logger);

    await notifier.publish(event);
    await notifier.publish(event);
    await notifier.publish(event);

    expect(redis.calls).toBe(3);
    expect(logger.warnings).toHaveLength(1);
  });

  it('warns again on a new outage after the channel came back', async () => {
    const redis = new FlakyRedis();
    const logger = new RecordingLogger();
    const notifier = new RedisEnrichmentNotifier(redis, logger);

    redis.down = true;
    await notifier.publish(event);
    redis.down = false;
    await notifier.publish(event);
    redis.down = true;
    await notifier.publish(event);

    expect(logger.warnings).toHaveLength(2);
  });

  it('never puts the link url or its preview in the message', async () => {
    const redis = new FakeRedis(1);

    await new RedisEnrichmentNotifier(redis, new RecordingLogger()).publish(
      event,
    );

    expect(Object.keys(JSON.parse(redis.published[0]?.message ?? ''))).toEqual([
      'type',
      'payload',
    ]);
  });
});
