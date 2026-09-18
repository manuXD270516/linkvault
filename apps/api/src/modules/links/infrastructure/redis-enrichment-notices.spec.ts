import {
  LINK_ENRICHED_CHANNEL,
  linkEnrichedEvent,
  type LinkEnrichedPayload,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  RedisEnrichmentNotices,
  type EnrichmentNoticesLogger,
  type RedisSubscriber,
} from './redis-enrichment-notices';

// Suscripción a los avisos de enriquecimiento (tarea 6.7) contra un doble del canal: ningún test abre Redis. Lo que se
// prueba es el contrato del canal —qué se acepta, qué se descarta y qué pasa si el reparto falla—, no ioredis.

/** Doble del cliente suscriptor: deja publicar en el canal y apunta a qué se suscribió. */
class ChannelDouble implements RedisSubscriber {
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  private readonly listeners = new Set<
    (channel: string, message: string) => void
  >();

  subscribe(channel: string): Promise<number> {
    this.subscribed.push(channel);
    return Promise.resolve(this.subscribed.length);
  }

  unsubscribe(channel: string): Promise<number> {
    this.unsubscribed.push(channel);
    return Promise.resolve(0);
  }

  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): this {
    if (event === 'message') {
      this.listeners.add(listener);
    }
    return this;
  }

  off(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): this {
    if (event === 'message') {
      this.listeners.delete(listener);
    }
    return this;
  }

  /** Cuántos escuchan el canal: es lo que dice si la suscripción es una por proceso. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Publica un mensaje crudo en un canal, como haría el worker. */
  publish(message: string, channel = LINK_ENRICHED_CHANNEL): void {
    for (const listener of this.listeners) {
      listener(channel, message);
    }
  }
}

class RecordingLogger implements EnrichmentNoticesLogger {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

const payload: LinkEnrichedPayload = {
  linkId: '000000000000000000000007',
  previewStatus: 'enriched',
  previewVersion: 2,
};

/** Espera a que se vacíe la cola de microtareas: el reparto es asíncrono y el canal no lo espera. */
function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('RedisEnrichmentNotices', () => {
  it('listens on the agreed channel, once', async () => {
    const channel = new ChannelDouble();
    const notices = new RedisEnrichmentNotices(channel);

    await notices.subscribe(() => Promise.resolve());

    expect(channel.subscribed).toEqual([LINK_ENRICHED_CHANNEL]);
    expect(channel.listenerCount).toBe(1);
  });

  it('hands over the notice that the worker published', async () => {
    const channel = new ChannelDouble();
    const received: LinkEnrichedPayload[] = [];
    await new RedisEnrichmentNotices(channel).subscribe((notice) => {
      received.push(notice);
      return Promise.resolve();
    });

    channel.publish(JSON.stringify(linkEnrichedEvent(payload)));
    await settled();

    expect(received).toEqual([payload]);
  });

  it.each([
    ['no válido como JSON', 'esto no es json'],
    ['de otro contrato', JSON.stringify({ type: 'Otro.v1', payload })],
    [
      'con una versión de cero',
      JSON.stringify(linkEnrichedEvent({ ...payload, previewVersion: 1 })).replace(
        '"previewVersion":1',
        '"previewVersion":0',
      ),
    ],
  ])('discards a message %s without touching anything', async (_name, raw) => {
    const channel = new ChannelDouble();
    const logger = new RecordingLogger();
    const received: LinkEnrichedPayload[] = [];
    await new RedisEnrichmentNotices(channel, logger).subscribe((notice) => {
      received.push(notice);
      return Promise.resolve();
    });

    channel.publish(raw);
    await settled();

    expect(received).toEqual([]);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings.join('\n')).not.toContain(raw);
  });

  it('ignores a message of another channel', async () => {
    const channel = new ChannelDouble();
    const received: LinkEnrichedPayload[] = [];
    await new RedisEnrichmentNotices(channel).subscribe((notice) => {
      received.push(notice);
      return Promise.resolve();
    });

    channel.publish(JSON.stringify(linkEnrichedEvent(payload)), 'events:otro');
    await settled();

    expect(received).toEqual([]);
  });

  it('keeps listening when delivering one notice fails', async () => {
    const channel = new ChannelDouble();
    const logger = new RecordingLogger();
    let calls = 0;
    await new RedisEnrichmentNotices(channel, logger).subscribe(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('mongo is having a bad day'))
        : Promise.resolve();
    });

    channel.publish(JSON.stringify(linkEnrichedEvent(payload)));
    await settled();
    channel.publish(JSON.stringify(linkEnrichedEvent(payload)));
    await settled();

    expect(calls).toBe(2);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).not.toContain('mongo is having a bad day');
  });

  it('stops listening when asked to', async () => {
    const channel = new ChannelDouble();
    const received: LinkEnrichedPayload[] = [];
    const stop = await new RedisEnrichmentNotices(channel).subscribe(
      (notice) => {
        received.push(notice);
        return Promise.resolve();
      },
    );

    await stop();
    channel.publish(JSON.stringify(linkEnrichedEvent(payload)));
    await settled();

    expect(channel.unsubscribed).toEqual([LINK_ENRICHED_CHANNEL]);
    expect(channel.listenerCount).toBe(0);
    expect(received).toEqual([]);
  });
});
