import { Redis } from 'ioredis';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisPingDouble } from './redis-ping-double';

// El doble solo implementa PING. ioredis 6 negocia RESP3 con HELLO y, ante -ERR, sigue en RESP2; su ready
// check (INFO) fallaría con -ERR, así que se desactiva.
function createClient(double: RedisPingDouble): Redis {
  const client = new Redis({
    host: double.host,
    port: double.port,
    lazyConnect: true,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // Los fallos esperados se comprueban por las promesas; el evento solo evita errores sin manejar.
  client.on('error', () => undefined);
  return client;
}

function sendRaw(double: RedisPingDouble, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(double.port, double.host, () =>
      socket.write(payload),
    );
    socket.once('data', (data) => {
      socket.destroy();
      resolve(data.toString('utf8'));
    });
    socket.once('error', reject);
  });
}

describe('RedisPingDouble', () => {
  let double: RedisPingDouble;
  const clients: Redis[] = [];

  function track(client: Redis): Redis {
    clients.push(client);
    return client;
  }

  beforeEach(async () => {
    double = await RedisPingDouble.start('up');
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    await double.close();
  });

  it('answers PONG to ioredis when up', async () => {
    const client = track(createClient(double));
    await client.connect();

    await expect(client.ping()).resolves.toBe('PONG');
  });

  it('refuses ioredis connections when stopped', async () => {
    await double.setMode('stop');
    const client = track(createClient(double));

    await expect(client.connect()).rejects.toThrow();
  });

  it('accepts the connection but never answers when hanging', async () => {
    await double.setMode('hang');
    const client = track(createClient(double));

    // ioredis espera la respuesta a su handshake (HELLO, CLIENT SETINFO) antes de enviar PING.
    const outcome = await Promise.race([
      client
        .connect()
        .then(() => client.ping())
        .then(
          () => 'answered',
          () => 'failed',
        ),
      delay(500).then(() => 'no-response'),
    ]);

    expect(outcome).toBe('no-response');
    expect(double.mode).toBe('hang');
  });

  it('serves again on the same port after going from stop to up', async () => {
    const port = double.port;
    await double.setMode('stop');
    await double.setMode('up');
    const client = track(createClient(double));
    await client.connect();

    expect(double.port).toBe(port);
    await expect(client.ping()).resolves.toBe('PONG');
  });

  it('parses inline PING and rejects other commands', async () => {
    await expect(sendRaw(double, 'PING\r\n')).resolves.toBe('+PONG\r\n');
    await expect(sendRaw(double, '*1\r\n$3\r\nGET\r\n')).resolves.toBe(
      "-ERR unknown command 'GET'\r\n",
    );
  });
});
