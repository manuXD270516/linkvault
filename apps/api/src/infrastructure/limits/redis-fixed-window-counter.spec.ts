import { RedisPingDouble } from '@linkvault/testing';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRedisAppClient } from '../redis/redis-app-client';
import {
  RedisFixedWindowCounter,
  type FixedWindowCounterLogger,
} from './redis-fixed-window-counter';

// Contador por ventana fija compartido por `auth` y `links` (tarea 6.5). Lo que se prueba aquí es lo que ninguno de los
// dos puede decidir por su cuenta: que cuenta de forma atómica y que, cuando el almacén no responde, lo **dice** en vez
// de elegir por quien llama. La política de fallo —abierto en el login y en la importación, cerrado en el reintento de
// una lectura— se prueba en cada uno de ellos.

const WINDOW = { limit: 2, windowMs: 60_000 };
const KEY = 'test:counter';

class RecordingLogger implements FixedWindowCounterLogger {
  readonly warnings: string[] = [];
  readonly infos: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  log(message: string): void {
    this.infos.push(message);
  }
}

let double: RedisPingDouble;
let client: Redis;
let logger: RecordingLogger;
let counter: RedisFixedWindowCounter;

beforeEach(async () => {
  double = await RedisPingDouble.start('up');
  client = createRedisAppClient(double.url);
  client.on('error', () => undefined);
  await client.connect();
  logger = new RecordingLogger();
  counter = new RedisFixedWindowCounter(client, logger);
});

afterEach(async () => {
  client.disconnect();
  await double.close();
});

describe('RedisFixedWindowCounter', () => {
  it('counts the attempts of a window and says when one no longer fits', async () => {
    expect(await counter.consume(KEY, WINDOW)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect((await counter.consume(KEY, WINDOW))?.allowed).toBe(true);

    const third = await counter.consume(KEY, WINDOW);

    expect(third?.allowed).toBe(false);
    expect(third?.retryAfterSeconds).toBeGreaterThan(0);
    expect(third?.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('counts each key on its own', async () => {
    await counter.consume(KEY, WINDOW);
    await counter.consume(KEY, WINDOW);

    expect((await counter.consume('test:other', WINDOW))?.allowed).toBe(true);
  });

  it('starts the window again after a reset', async () => {
    await counter.consume(KEY, WINDOW);
    await counter.consume(KEY, WINDOW);

    expect(await counter.reset(KEY)).toBe(true);
    expect((await counter.consume(KEY, WINDOW))?.allowed).toBe(true);
  });

  it('gives an attempt back without leaving the key alive forever', async () => {
    await counter.consume(KEY, WINDOW);

    expect(await counter.giveBack(KEY)).toBe(true);
    expect((await counter.consume(KEY, WINDOW))?.allowed).toBe(true);
    expect((await counter.consume(KEY, WINDOW))?.allowed).toBe(true);
  });

  it('never gives back more than it took: the counter does not go below zero', async () => {
    await counter.consume(KEY, WINDOW);

    expect(await counter.giveBack(KEY)).toBe(true);
    expect(await counter.giveBack(KEY)).toBe(true);

    // Sin crédito acumulado: caben exactamente los dos de la ventana, no tres.
    expect((await counter.consume(KEY, WINDOW))?.allowed).toBe(true);
    expect((await counter.consume(KEY, WINDOW))?.allowed).toBe(true);
    expect((await counter.consume(KEY, WINDOW))?.allowed).toBe(false);
  });

  it('says that the store did not answer instead of deciding for the caller', async () => {
    await double.setMode('stop');

    expect(await counter.consume(KEY, WINDOW)).toBeNull();
    expect(await counter.reset(KEY)).toBe(false);
    expect(await counter.giveBack(KEY)).toBe(false);
    // Un aviso por racha, y sin la clave: puede llevar el resumen de un email.
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings.join('\n')).not.toContain(KEY);
  });
});
