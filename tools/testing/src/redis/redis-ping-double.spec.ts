import { Redis } from 'ioredis';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisPingDouble } from './redis-ping-double';

// El doble implementa PING, GET, SET y DEL. ioredis 6 negocia RESP3 con HELLO y, ante -ERR, sigue en RESP2; su ready
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
    await expect(sendRaw(double, '*1\r\n$4\r\nINFO\r\n')).resolves.toBe(
      "-ERR unknown command 'INFO'\r\n",
    );
  });

  describe('key-value commands', () => {
    it('stores a value with SET and returns it with GET', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.set('ai:cache:v1:k', '{"a":"ñ"}')).resolves.toBe(
        'OK',
      );
      await expect(client.get('ai:cache:v1:k')).resolves.toBe('{"a":"ñ"}');
      await expect(client.get('missing')).resolves.toBeNull();
    });

    it('expires a key set with EX seconds', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.set('ex-key', 'v', 'EX', 1)).resolves.toBe('OK');
      await expect(client.get('ex-key')).resolves.toBe('v');
      await delay(1_100);
      await expect(client.get('ex-key')).resolves.toBeNull();
    });

    it('expires a key set with PX milliseconds', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.set('px-key', 'v', 'PX', 100)).resolves.toBe('OK');
      await expect(client.get('px-key')).resolves.toBe('v');
      await delay(150);
      await expect(client.get('px-key')).resolves.toBeNull();
    });

    it('overwrites a value and drops its previous expiration', async () => {
      const client = track(createClient(double));
      await client.connect();

      await client.set('key', 'first', 'PX', 100);
      await client.set('key', 'second');
      await delay(150);
      await expect(client.get('key')).resolves.toBe('second');
    });

    it('deletes keys with DEL and counts only the live ones', async () => {
      const client = track(createClient(double));
      await client.connect();
      await client.set('a', '1');
      await client.set('b', '2');
      await client.set('expired', '3', 'PX', 50);
      await delay(100);

      await expect(client.del('a', 'b', 'expired', 'missing')).resolves.toBe(
        2,
      );
      await expect(client.get('a')).resolves.toBeNull();
      await expect(client.del('a')).resolves.toBe(0);
    });

    it('answers in RESP2: nil bulk string, simple OK, bulk string and integer', async () => {
      const get = '*2\r\n$3\r\nGET\r\n$1\r\nk\r\n';
      await expect(sendRaw(double, get)).resolves.toBe('$-1\r\n');
      await expect(
        sendRaw(double, '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$3\r\nvé\r\n'),
      ).resolves.toBe('+OK\r\n');
      await expect(sendRaw(double, get)).resolves.toBe('$3\r\nvé\r\n');
      await expect(
        sendRaw(double, '*2\r\n$3\r\nDEL\r\n$1\r\nk\r\n'),
      ).resolves.toBe(':1\r\n');
    });

    it('rejects invalid SET options like Redis does', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.set('k', 'v', 'EX', 0)).rejects.toThrow(
        "invalid expire time in 'set' command",
      );
      await expect(client.call('SET', 'k', 'v', 'PX', 'soon')).rejects.toThrow(
        'value is not an integer or out of range',
      );
      await expect(client.call('SET', 'k', 'v', 'KEEPTTL')).rejects.toThrow(
        'syntax error',
      );
      await expect(client.get('k')).resolves.toBeNull();
    });

    it('loses stored keys when it goes through stop', async () => {
      const writer = track(createClient(double));
      await writer.connect();
      await writer.set('k', 'v');

      await double.setMode('stop');
      await double.setMode('up');
      const reader = track(createClient(double));
      await reader.connect();

      await expect(reader.get('k')).resolves.toBeNull();
    });
  });
});
