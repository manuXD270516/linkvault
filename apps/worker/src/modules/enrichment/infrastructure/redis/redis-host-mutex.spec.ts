import { describe, expect, it } from 'vitest';
import {
  RedisHostMutex,
  hostMutexKey,
  type HostMutexClient,
} from './redis-host-mutex';

// Requisito "Cortesía con los sitios" (specs/links/enrichment) y D6 de link-enrichment. La exclusión se prueba contra
// un Redis en memoria que respeta `PX` y `NX` con un reloj propio: ningún test abre una conexión ni espera de verdad.

const FETCH_TIMEOUT_MS = 10_000;

/** Redis mínimo con vencimiento por `PX` y exclusión por `NX`, gobernado por un reloj que avanza el test. */
class FakeRedis implements HostMutexClient {
  private now = 0;
  private readonly entries = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  advance(ms: number): void {
    this.now += ms;
  }

  valueOf(key: string): string | null {
    return this.live(key)?.value ?? null;
  }

  expiresInOf(key: string): number | null {
    const entry = this.live(key);
    return entry === null ? null : entry.expiresAt - this.now;
  }

  set(
    key: string,
    value: string,
    _mode: 'PX',
    ms: number,
    condition?: 'NX',
  ): Promise<'OK' | null> {
    if (condition === 'NX' && this.live(key) !== null) {
      return Promise.resolve(null);
    }
    this.entries.set(key, { value, expiresAt: this.now + ms });
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.entries.delete(key) ? 1 : 0);
  }

  private live(key: string): { value: string; expiresAt: number } | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.now) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }
}

function mutexOf(client: FakeRedis = new FakeRedis()): {
  mutex: RedisHostMutex;
  client: FakeRedis;
} {
  return {
    mutex: new RedisHostMutex(client, FETCH_TIMEOUT_MS),
    client,
  };
}

describe('Una descarga a la vez por dominio', () => {
  it('lets only one turn in while the download lasts', async () => {
    const { mutex } = mutexOf();

    const first = await mutex.acquire('bolsa.example');
    const second = await mutex.acquire('bolsa.example');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('holds the host for the fetch timeout, not for the wait', async () => {
    // La exclusión dura lo que puede durar la descarga: si el proceso muere a medias, el host se libera solo.
    const { mutex, client } = mutexOf();

    await mutex.acquire('bolsa.example');

    expect(client.expiresInOf(hostMutexKey('bolsa.example'))).toBe(
      FETCH_TIMEOUT_MS,
    );
  });

  it('turns the turn into the wait the site asked for, without freeing it in between', async () => {
    // Una página que tardó 300 ms no puede retener su host diez segundos: al soltar, la clave pasa a durar la espera.
    const { mutex, client } = mutexOf();
    const key = hostMutexKey('bolsa.example');

    const lease = await mutex.acquire('bolsa.example');
    client.advance(300);
    await lease?.release(2_000);

    expect(client.expiresInOf(key)).toBe(2_000);
    // Y nadie pudo colarse: la clave nunca dejó de existir.
    expect(await mutex.acquire('bolsa.example')).toBeNull();
  });

  it('keeps the next link out until the wait is over', async () => {
    const { mutex, client } = mutexOf();

    const lease = await mutex.acquire('bolsa.example');
    await lease?.release(2_000);

    client.advance(1_999);
    expect(await mutex.acquire('bolsa.example')).toBeNull();
    client.advance(2);
    expect(await mutex.acquire('bolsa.example')).not.toBeNull();
  });

  it('frees the host at once when no wait is asked for', async () => {
    const { mutex, client } = mutexOf();

    const lease = await mutex.acquire('bolsa.example');
    await lease?.release(0);

    expect(client.valueOf(hostMutexKey('bolsa.example'))).toBeNull();
    expect(await mutex.acquire('bolsa.example')).not.toBeNull();
  });

  it('frees the host on its own if the process dies mid-download', async () => {
    const { mutex, client } = mutexOf();

    await mutex.acquire('bolsa.example');
    client.advance(FETCH_TIMEOUT_MS);

    expect(await mutex.acquire('bolsa.example')).not.toBeNull();
  });

  it('does not fail the enrichment when Redis refuses the release', async () => {
    const client = new FakeRedis();
    const flaky: HostMutexClient = {
      set: (
        key: string,
        value: string,
        mode: 'PX',
        ms: number,
        condition?: 'NX',
      ) =>
        condition === 'NX'
          ? client.set(key, value, mode, ms, condition)
          : Promise.reject(new Error('redis down')),
      del: () => Promise.reject(new Error('redis down')),
    };
    const mutex = new RedisHostMutex(flaky, FETCH_TIMEOUT_MS);

    const lease = await mutex.acquire('bolsa.example');

    await expect(lease?.release(2_000)).resolves.toBeUndefined();
  });
});

describe('Dos dominios distintos', () => {
  it('runs in parallel, because the key is per host', async () => {
    const { mutex } = mutexOf();

    const trabajopolis = await mutex.acquire('trabajopolis.example');
    const getonbrd = await mutex.acquire('getonbrd.example');

    expect(trabajopolis).not.toBeNull();
    expect(getonbrd).not.toBeNull();
  });

  it('does not let one host wait for another', async () => {
    const { mutex, client } = mutexOf();

    const lease = await mutex.acquire('trabajopolis.example');
    await lease?.release(10_000);

    expect(await mutex.acquire('trabajopolis.example')).toBeNull();
    expect(await mutex.acquire('getonbrd.example')).not.toBeNull();
    expect(client.valueOf(hostMutexKey('getonbrd.example'))).not.toBeNull();
  });
});
