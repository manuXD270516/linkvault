import {
  LINK_ENRICHED_CHANNEL,
  linkEnrichedEvent,
  type LinkEnrichedPayload,
} from '@linkvault/shared';
import { RedisPingDouble } from '@linkvault/testing';
import { Redis } from 'ioredis';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createRedisSubscriberClient } from '../../../infrastructure/redis/redis-subscriber-client';
import {
  RedisEnrichmentNotices,
  type EnrichmentNoticesLogger,
} from './redis-enrichment-notices';

// El canal de avisos contra un Redis de verdad (uno de mentira que habla RESP, sin red). Es el test que faltaba: con un
// doble del cliente que acepta comandos siempre, la suscripción "funcionaba" en la suite y no salía en ninguna
// ejecución real, porque el `SUBSCRIBE` se emitía antes de que existiera la conexión.

const payload: LinkEnrichedPayload = {
  linkId: '000000000000000000000007',
  previewStatus: 'enriched',
  previewVersion: 2,
};

class RecordingLogger implements EnrichmentNoticesLogger {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

const doubles: RedisPingDouble[] = [];
const clients: Redis[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }
  for (const double of doubles.splice(0)) {
    await double.close();
  }
});

/** Cliente aparte para publicar, que es lo que hace el worker: un suscriptor no puede publicar. */
function publisherOn(double: RedisPingDouble): Redis {
  const client = new Redis(double.url, { enableReadyCheck: false });
  client.on('error', () => undefined);
  clients.push(client);
  return client;
}

/** Espera a que algo pase, sin fiarse de cuánto tarda una conexión en fallar. */
async function eventually(happened: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !happened(); attempt += 1) {
    await delay(25);
  }
}

/**
 * Publica hasta que haya alguien escuchando: `PUBLISH` contesta cuántos lo recibieron, así que el cero dice que la
 * suscripción todavía no ha llegado. Sin esto, un test que publica una sola vez depende de quién gane la carrera.
 */
async function publishUntilHeard(
  publisher: Redis,
  message: string,
): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const heard = await publisher.publish(LINK_ENRICHED_CHANNEL, message);
    if (heard > 0) return heard;
    await delay(25);
  }
  throw new Error('nobody ever subscribed to the channel');
}

describe('RedisEnrichmentNotices over a real connection', () => {
  it('receives what the worker publishes on the agreed channel', async () => {
    const double = await RedisPingDouble.start('up');
    doubles.push(double);
    const client = createRedisSubscriberClient(double.url);
    clients.push(client);
    const logger = new RecordingLogger();
    const received: LinkEnrichedPayload[] = [];

    await new RedisEnrichmentNotices(client, logger).subscribe((notice) => {
      received.push(notice);
      return Promise.resolve();
    });
    await publishUntilHeard(
      publisherOn(double),
      JSON.stringify(linkEnrichedEvent(payload)),
    );
    await delay(50);

    expect(received).toEqual([payload]);
    expect(logger.warnings).toEqual([]);
  });

  it(
    'does not throw when Redis is down at startup, and listens once it is back',
    { timeout: 30_000 },
    async () => {
      // Un Redis caído al arrancar no puede tumbar `api`: se avisa una vez y se sigue sirviendo peticiones.
      const double = await RedisPingDouble.start('up');
      doubles.push(double);
      await double.setMode('stop');
      const client = createRedisSubscriberClient(double.url);
      clients.push(client);
      const logger = new RecordingLogger();
      const received: LinkEnrichedPayload[] = [];

      const stop = await new RedisEnrichmentNotices(client, logger).subscribe(
        (notice) => {
          received.push(notice);
          return Promise.resolve();
        },
      );

      expect(stop).toBeTypeOf('function');
      await eventually(() => logger.warnings.length > 0);
      expect(logger.warnings).toHaveLength(1);
      expect(logger.warnings[0]).toContain('will not update on their own');

      // Y cuando Redis vuelve, el canal acaba funcionando solo: ioredis reconecta, pero la suscripción que nunca salió
      // hay que volver a pedirla.
      await double.setMode('up');
      await publishUntilHeard(
        publisherOn(double),
        JSON.stringify(linkEnrichedEvent(payload)),
      );
      await delay(50);

      expect(received).toEqual([payload]);
      expect(logger.warnings).toHaveLength(1);
    },
  );
});
