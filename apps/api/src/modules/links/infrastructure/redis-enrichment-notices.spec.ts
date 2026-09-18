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
//
// El doble **rechaza cualquier comando mientras no se haya conectado**, igual que el cliente de verdad con
// `lazyConnect` y `enableOfflineQueue: false`. Un doble que aceptaba comandos siempre fue lo que dejó pasar a
// producción una suscripción que nunca salía: el arranque avisaba "Could not subscribe…" y el reparto por SSE quedaba
// muerto mientras los previews se escribían igual.

/**
 * Doble del cliente suscriptor: deja publicar en el canal y apunta a qué se suscribió. Empieza en `wait`, como un
 * cliente `lazyConnect` recién creado, y hasta que no conecta contesta a cualquier comando lo mismo que ioredis sin
 * cola de comandos.
 */
class ChannelDouble implements RedisSubscriber {
  status = 'wait';
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  /** Veces que se le pidió conectar: hacerlo dos veces sería un "already connecting/connected". */
  connects = 0;
  private readonly listeners = new Set<(...args: string[]) => void>();
  private readonly readyListeners = new Set<(...args: string[]) => void>();

  /** `reachable` en `false` es un Redis que no está: conectar falla y el cliente se queda reintentando. */
  constructor(private reachable = true) {}

  connect(): Promise<void> {
    this.connects += 1;
    if (this.status !== 'wait') {
      return Promise.reject(new Error('Redis is already connecting/connected'));
    }
    if (!this.reachable) {
      // Como ioredis: la promesa se rompe, pero el cliente sigue reintentando la conexión por su cuenta.
      this.status = 'reconnecting';
      return Promise.reject(new Error('connect ECONNREFUSED'));
    }
    this.status = 'ready';
    // La conexión queda lista un poco después de pedirla, y se avisa con `ready`, que es cuando un comando sale.
    queueMicrotask(() => this.announceReady());
    return Promise.resolve();
  }

  subscribe(channel: string): Promise<number> {
    if (this.status !== 'ready') return Promise.reject(offline());
    this.subscribed.push(channel);
    return Promise.resolve(this.subscribed.length);
  }

  unsubscribe(channel: string): Promise<number> {
    if (this.status !== 'ready') return Promise.reject(offline());
    this.unsubscribed.push(channel);
    return Promise.resolve(0);
  }

  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): this;
  on(event: 'ready', listener: () => void): this;
  on(event: string, listener: (...args: string[]) => void): this {
    if (event === 'message') this.listeners.add(listener);
    if (event === 'ready') this.readyListeners.add(listener);
    return this;
  }

  off(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): this;
  off(event: 'ready', listener: () => void): this;
  off(event: string, listener: (...args: string[]) => void): this {
    if (event === 'message') this.listeners.delete(listener);
    if (event === 'ready') this.readyListeners.delete(listener);
    return this;
  }

  /** Cuántos escuchan el canal: es lo que dice si la suscripción es una por proceso. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Redis vuelve: el cliente reconecta por su cuenta y lo avisa con `ready`. */
  comeBack(): void {
    this.reachable = true;
    this.status = 'ready';
    this.announceReady();
  }

  private announceReady(): void {
    for (const listener of this.readyListeners) {
      listener();
    }
  }

  /** Publica un mensaje crudo en un canal, como haría el worker. */
  publish(message: string, channel = LINK_ENRICHED_CHANNEL): void {
    for (const listener of this.listeners) {
      listener(channel, message);
    }
  }
}

/** Lo que contesta ioredis a un comando emitido sin conexión y sin cola. */
function offline(): Error {
  return new Error(
    "Stream isn't writeable and enableOfflineQueue options is false",
  );
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
    await settled();

    expect(channel.subscribed).toEqual([LINK_ENRICHED_CHANNEL]);
    expect(channel.listenerCount).toBe(1);
  });

  it('connects before subscribing, on a client that refuses commands while offline', async () => {
    // Lo que destapó el smoke: sin conexión, el `SUBSCRIBE` se rechaza antes de que exista el socket, y entonces no hay
    // reparto por SSE por mucho que el preview se escriba.
    const channel = new ChannelDouble();
    const logger = new RecordingLogger();
    const received: LinkEnrichedPayload[] = [];

    await new RedisEnrichmentNotices(channel, logger).subscribe((notice) => {
      received.push(notice);
      return Promise.resolve();
    });
    channel.publish(JSON.stringify(linkEnrichedEvent(payload)));
    await settled();

    expect(channel.connects).toBe(1);
    expect(channel.subscribed).toEqual([LINK_ENRICHED_CHANNEL]);
    expect(received).toEqual([payload]);
    expect(logger.warnings).toEqual([]);
  });

  it('does not open a connection that is already open', async () => {
    const channel = new ChannelDouble();
    channel.status = 'ready';

    await new RedisEnrichmentNotices(channel).subscribe(() =>
      Promise.resolve(),
    );

    // Con la conexión en pie nadie va a emitir `ready`, así que el canal se pide en el acto.
    expect(channel.connects).toBe(0);
    expect(channel.subscribed).toEqual([LINK_ENRICHED_CHANNEL]);
  });

  it('warns once when Redis is not there and listens when it comes back', async () => {
    const channel = new ChannelDouble(false);
    const logger = new RecordingLogger();
    const received: LinkEnrichedPayload[] = [];

    // Suscribirse no lanza: un Redis caído no puede tumbar el arranque de `api`.
    const stop = await new RedisEnrichmentNotices(channel, logger).subscribe(
      (notice) => {
        received.push(notice);
        return Promise.resolve();
      },
    );

    await settled();

    expect(stop).toBeTypeOf('function');
    expect(channel.subscribed).toEqual([]);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('will not update on their own');

    // El cliente reconecta por su cuenta, pero al reconectar solo reenvía las suscripciones que llegó a aceptar, y esta
    // nunca salió: el canal hay que volver a pedirlo.
    channel.comeBack();
    await settled();
    channel.publish(JSON.stringify(linkEnrichedEvent(payload)));
    await settled();

    expect(channel.subscribed).toEqual([LINK_ENRICHED_CHANNEL]);
    expect(received).toEqual([payload]);
    expect(logger.warnings).toHaveLength(1);
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
      JSON.stringify(
        linkEnrichedEvent({ ...payload, previewVersion: 1 }),
      ).replace('"previewVersion":1', '"previewVersion":0'),
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
