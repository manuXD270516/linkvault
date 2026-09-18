import { RedisPingDouble } from '@linkvault/testing';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRedisSubscriberClient,
  REDIS_SUBSCRIBER_CONNECT_TIMEOUT_MS,
  RedisSubscriberConnection,
} from './redis-subscriber-client';

// El cliente en modo suscripción del canal de avisos (D9 de link-enrichment). Lo que se prueba aquí es la
// configuración, porque es donde estaba el defecto: con la del cliente de aplicación (`commandTimeout` de 200 ms para
// que el limitador falle abierto), un `SUBSCRIBE` emitido en el arranque se rechazaba antes de que existiera el socket.

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

function ended(client: Redis): Promise<void> {
  if (client.status === 'end') return Promise.resolve();
  return new Promise((resolve) => client.once('end', () => resolve()));
}

describe('createRedisSubscriberClient', () => {
  it('creates a lazy client with no command budget, unlike the application one', () => {
    const client = createRedisSubscriberClient('redis://127.0.0.1:6379');
    clients.push(client);

    expect(client.status).toBe('wait');
    expect(client.options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      connectTimeout: REDIS_SUBSCRIBER_CONNECT_TIMEOUT_MS,
    });
    // Un `SUBSCRIBE` dura lo que dura el proceso y no está en el camino de ninguna petición: el presupuesto de 200 ms
    // del cliente de aplicación no pinta nada aquí.
    expect(client.options.commandTimeout).toBeUndefined();
  });

  it('subscribes to a channel once it is connected', async () => {
    const double = await RedisPingDouble.start('up');
    doubles.push(double);
    const client = createRedisSubscriberClient(double.url);
    clients.push(client);

    await client.connect();

    await expect(client.subscribe('events:link')).resolves.toBe(1);
  });

  it('refuses a command emitted before connecting, which is why whoever subscribes connects first', async () => {
    const double = await RedisPingDouble.start('up');
    doubles.push(double);
    const client = createRedisSubscriberClient(double.url);
    clients.push(client);

    // Sin cola de comandos, ioredis contesta que no en el acto en vez de dejar el `SUBSCRIBE` pendiente para siempre.
    await expect(client.subscribe('events:link')).rejects.toThrow(
      /enableOfflineQueue/,
    );
  });

  it('closes the connection when the application shuts down', async () => {
    const double = await RedisPingDouble.start('up');
    doubles.push(double);
    const client = createRedisSubscriberClient(double.url);
    clients.push(client);
    await client.connect();

    new RedisSubscriberConnection(client).onApplicationShutdown();

    await ended(client);
    expect(client.status).toBe('end');
  });
});
