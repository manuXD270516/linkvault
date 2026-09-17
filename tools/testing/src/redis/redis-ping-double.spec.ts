import { Redis } from 'ioredis';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisPingDouble } from './redis-ping-double';

// El doble implementa PING, GET, SET, DEL, INCR, DECR, PTTL y MULTI/EXEC/DISCARD. ioredis 6 negocia RESP3 con HELLO y,
// ante -ERR, sigue en RESP2; su ready check (INFO) fallaría con -ERR, así que se desactiva.
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

/** Envía varios comandos por una misma conexión y acumula la respuesta hasta alcanzar la longitud esperada. */
function sendRawUntil(
  double: RedisPingDouble,
  payload: string,
  expected: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = '';
    const socket = connect(double.port, double.host, () =>
      socket.write(payload),
    );
    socket.on('data', (data) => {
      received += data.toString('utf8');
      if (received.length >= expected.length) {
        socket.destroy();
        resolve(received);
      }
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

      await expect(client.del('a', 'b', 'expired', 'missing')).resolves.toBe(2);
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

    it('does not overwrite an existing key with SET NX and answers nil', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.set('k', '0', 'PX', 60_000, 'NX')).resolves.toBe(
        'OK',
      );
      await client.incr('k');
      await expect(
        client.set('k', '0', 'PX', 60_000, 'NX'),
      ).resolves.toBeNull();
      await expect(client.get('k')).resolves.toBe('1');
    });

    it('expires a key set with PX NX and lets SET NX write it again', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.set('k', '0', 'PX', 100, 'NX')).resolves.toBe('OK');
      await client.incr('k');
      await delay(150);
      await expect(client.get('k')).resolves.toBeNull();
      await expect(client.set('k', '0', 'PX', 100, 'NX')).resolves.toBe('OK');
      await expect(client.get('k')).resolves.toBe('0');
    });

    it('increments and decrements counters keeping their expiration', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.incr('fresh')).resolves.toBe(1);
      await expect(client.pttl('fresh')).resolves.toBe(-1);
      await client.set('counter', '5', 'PX', 100);
      await expect(client.incr('counter')).resolves.toBe(6);
      await expect(client.decr('counter')).resolves.toBe(5);
      await expect(client.decr('missing')).resolves.toBe(-1);
      await delay(150);
      await expect(client.get('counter')).resolves.toBeNull();
    });

    it('rejects INCR on values that are not 64-bit integers', async () => {
      const client = track(createClient(double));
      await client.connect();
      await client.set('text', 'abc');
      await client.set('padded', '01');
      await client.set('max', '9223372036854775807');

      await expect(client.incr('text')).rejects.toThrow(
        'value is not an integer or out of range',
      );
      await expect(client.incr('padded')).rejects.toThrow(
        'value is not an integer or out of range',
      );
      await expect(client.incr('max')).rejects.toThrow(
        'increment or decrement would overflow',
      );
      await expect(client.get('max')).resolves.toBe('9223372036854775807');
    });

    it('reports remaining milliseconds with PTTL, -1 without expiration and -2 when missing', async () => {
      const client = track(createClient(double));
      await client.connect();
      await client.set('ttl', 'v', 'PX', 900_000);
      await client.set('forever', 'v');

      const remaining = await client.pttl('ttl');
      expect(remaining).toBeGreaterThan(899_000);
      expect(remaining).toBeLessThanOrEqual(900_000);
      await expect(client.pttl('forever')).resolves.toBe(-1);
      await expect(client.pttl('missing')).resolves.toBe(-2);
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

  describe('transactions', () => {
    it('returns the results of SET NX, INCR and PTTL from EXEC', async () => {
      const client = track(createClient(double));
      await client.connect();

      const first = await client
        .multi()
        .set('attempts', '0', 'PX', 900_000, 'NX')
        .incr('attempts')
        .pttl('attempts')
        .exec();
      const second = await client
        .multi()
        .set('attempts', '0', 'PX', 900_000, 'NX')
        .incr('attempts')
        .pttl('attempts')
        .exec();

      expect(first?.slice(0, 2)).toEqual([
        [null, 'OK'],
        [null, 1],
      ]);
      expect(first?.[2]?.[1]).toBeGreaterThan(899_000);
      expect(second?.slice(0, 2)).toEqual([
        [null, null],
        [null, 2],
      ]);
      expect(second?.[2]?.[1]).toBeLessThanOrEqual(900_000);
    });

    it('runs DEL and DECR together in a transaction', async () => {
      const client = track(createClient(double));
      await client.connect();
      await client.set('email', '3', 'PX', 900_000);
      await client.set('ip', '4', 'PX', 900_000);

      await expect(
        client.multi().del('email').decr('ip').exec(),
      ).resolves.toEqual([
        [null, 1],
        [null, 3],
      ]);
      await expect(client.get('email')).resolves.toBeNull();
      expect(await client.pttl('ip')).toBeGreaterThan(0);
    });

    it('answers QUEUED while in MULTI and an array of results on EXEC', async () => {
      const payload =
        '*1\r\n$5\r\nMULTI\r\n' +
        '*2\r\n$4\r\nINCR\r\n$1\r\nk\r\n' +
        '*2\r\n$4\r\nPTTL\r\n$1\r\nk\r\n' +
        '*1\r\n$4\r\nEXEC\r\n';

      await expect(
        sendRawUntil(
          double,
          payload,
          '+OK\r\n+QUEUED\r\n+QUEUED\r\n*2\r\n:1\r\n:-1\r\n',
        ),
      ).resolves.toBe('+OK\r\n+QUEUED\r\n+QUEUED\r\n*2\r\n:1\r\n:-1\r\n');
    });

    it('does not apply queued commands until EXEC and drops them on DISCARD', async () => {
      const client = track(createClient(double));
      await client.connect();

      await expect(client.call('MULTI')).resolves.toBe('OK');
      await expect(client.call('INCR', 'k')).resolves.toBe('QUEUED');
      await expect(client.call('DISCARD')).resolves.toBe('OK');
      await expect(client.get('k')).resolves.toBeNull();
    });

    it('aborts EXEC after a command rejected while queuing and keeps runtime errors inside the array', async () => {
      const client = track(createClient(double));
      await client.connect();
      await client.set('text', 'abc');

      await expect(client.call('EXEC')).rejects.toThrow('EXEC without MULTI');
      const results = await client.multi().incr('text').incr('counter').exec();
      expect(results?.[0]?.[0]?.message).toContain(
        'value is not an integer or out of range',
      );
      expect(results?.[1]).toEqual([null, 1]);

      await expect(client.call('MULTI')).resolves.toBe('OK');
      await expect(client.call('INCR', 'counter')).resolves.toBe('QUEUED');
      await expect(client.call('INCR')).rejects.toThrow(
        "wrong number of arguments for 'incr' command",
      );
      await expect(client.call('EXEC')).rejects.toThrow('EXECABORT');
      await expect(client.get('counter')).resolves.toBe('1');
    });

    it('keeps transaction state per connection', async () => {
      const inTransaction = track(createClient(double));
      const other = track(createClient(double));
      await inTransaction.connect();
      await other.connect();

      await inTransaction.call('MULTI');
      await expect(other.incr('k')).resolves.toBe(1);
      await expect(inTransaction.call('INCR', 'k')).resolves.toBe('QUEUED');
      await expect(inTransaction.call('EXEC')).resolves.toEqual([2]);
    });
  });
});
