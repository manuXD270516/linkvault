import { describe, expect, it } from 'vitest';
import type { DiscoveryHttpFetch } from './getonboard-discovery.adapter';
import {
  REMOTEOK_API_URL,
  REMOTEOK_DUMP_CACHE_KEY,
  REMOTEOK_DUMP_LOCK_KEY,
  REMOTEOK_DUMP_STALE_KEY,
  RemoteokDiscoveryAdapter,
  type RemoteokDumpRedis,
  type RemoteokEgressLimiter,
} from './remoteok-discovery.adapter';

const USER_AGENT = 'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)';

const DUMP = JSON.stringify([
  { last_updated: 1, legal: '…' },
  {
    id: '1130248',
    position: 'Customer Support Specialist',
    company: 'Example Co',
    location: 'Worldwide',
    slug: '1130248-customer-support-specialist-example-co',
    salary_min: 55_000,
    salary_max: 80_000,
  },
  {
    id: 99001,
    position: 'Senior React Engineer',
    company: 'Orbit',
    location: 'Remote',
    slug: '99001-senior-react-engineer-orbit',
  },
]);

class MemoryRedis implements RemoteokDumpRedis {
  readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, mode: 'EX', seconds: number): Promise<'OK'>;
  set(
    key: string,
    value: string,
    mode: 'PX',
    ms: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
  set(
    key: string,
    value: string,
    _mode: 'EX' | 'PX',
    _ttl: number,
    condition?: 'NX',
  ): Promise<'OK' | null> {
    if (condition === 'NX' && this.store.has(key)) {
      return Promise.resolve(null);
    }
    this.store.set(key, value);
    return Promise.resolve('OK');
  }
}

function alwaysEgress(allowed: boolean): RemoteokEgressLimiter {
  return { tryAcquire: () => Promise.resolve(allowed) };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function dumpFetch(body = DUMP, status = 200): DiscoveryHttpFetch {
  return (url) => {
    expect(url).toBe(REMOTEOK_API_URL);
    return Promise.resolve(
      new Response(body, {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

describe('RemoteokDiscoveryAdapter', () => {
  it('fetches dump, caches it, and returns canonical urls', async () => {
    const redis = new MemoryRedis();
    const adapter = new RemoteokDiscoveryAdapter({
      httpFetch: dumpFetch(),
      userAgent: USER_AGENT,
      redis,
      egress: alwaysEgress(true),
      sleep: () => Promise.resolve(),
    });

    const result = await adapter.search({
      q: 'react',
      page: 1,
      pageSize: 10,
      lang: 'en',
      signal: signal(),
    });

    expect(result).toEqual({
      kind: 'hits',
      hits: [
        {
          board: 'remoteok',
          title: 'Senior React Engineer',
          company: 'Orbit',
          location: 'Remote',
          url: 'https://remoteok.com/remote-jobs/99001-senior-react-engineer-orbit',
          externalJobId: '99001',
        },
      ],
    });
    expect(redis.store.has(REMOTEOK_DUMP_CACHE_KEY)).toBe(true);
    expect(redis.store.has(REMOTEOK_DUMP_STALE_KEY)).toBe(true);
  });

  it('serves cache without a second egress fetch', async () => {
    const redis = new MemoryRedis();
    redis.store.set(REMOTEOK_DUMP_CACHE_KEY, DUMP);
    let fetches = 0;
    const httpFetch: DiscoveryHttpFetch = () => {
      fetches += 1;
      return Promise.reject(new Error('should not fetch'));
    };

    const result = await new RemoteokDiscoveryAdapter({
      httpFetch,
      userAgent: USER_AGENT,
      redis,
      egress: alwaysEgress(false),
      sleep: () => Promise.resolve(),
    }).search({
      q: '',
      page: 1,
      pageSize: 1,
      lang: 'en',
      signal: signal(),
    });

    expect(result.kind).toBe('hits');
    if (result.kind === 'hits') {
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]?.externalJobId).toBe('1130248');
    }
    expect(fetches).toBe(0);
  });

  it('serves stale when egress is blocked', async () => {
    const redis = new MemoryRedis();
    redis.store.set(REMOTEOK_DUMP_STALE_KEY, DUMP);

    const result = await new RemoteokDiscoveryAdapter({
      httpFetch: () => Promise.reject(new Error('no')),
      userAgent: USER_AGENT,
      redis,
      egress: alwaysEgress(false),
      sleep: () => Promise.resolve(),
    }).search({
      q: '',
      page: 1,
      pageSize: 10,
      lang: 'en',
      signal: signal(),
    });

    expect(result.kind).toBe('hits');
  });

  it('degrades egress_limited when no stale', async () => {
    const redis = new MemoryRedis();
    const result = await new RemoteokDiscoveryAdapter({
      httpFetch: () => Promise.reject(new Error('no')),
      userAgent: USER_AGENT,
      redis,
      egress: alwaysEgress(false),
      sleep: () => Promise.resolve(),
    }).search({
      q: '',
      page: 1,
      pageSize: 10,
      lang: 'en',
      signal: signal(),
    });

    expect(result).toEqual({ kind: 'degraded', reason: 'egress_limited' });
  });

  it('degrades upstream_429', async () => {
    const redis = new MemoryRedis();
    const result = await new RemoteokDiscoveryAdapter({
      httpFetch: dumpFetch('[]', 429),
      userAgent: USER_AGENT,
      redis,
      egress: alwaysEgress(true),
      sleep: () => Promise.resolve(),
    }).search({
      q: '',
      page: 1,
      pageSize: 10,
      lang: 'en',
      signal: signal(),
    });

    expect(result).toEqual({ kind: 'degraded', reason: 'upstream_429' });
  });

  it('waits on single-flight lock then reads cache', async () => {
    const redis = new MemoryRedis();
    redis.store.set(REMOTEOK_DUMP_LOCK_KEY, '1');
    let slept = false;
    const adapter = new RemoteokDiscoveryAdapter({
      httpFetch: () => Promise.reject(new Error('no')),
      userAgent: USER_AGENT,
      redis,
      egress: alwaysEgress(true),
      sleep: async () => {
        slept = true;
        redis.store.set(REMOTEOK_DUMP_CACHE_KEY, DUMP);
      },
    });

    const result = await adapter.search({
      q: '',
      page: 1,
      pageSize: 10,
      lang: 'en',
      signal: signal(),
    });

    expect(slept).toBe(true);
    expect(result.kind).toBe('hits');
  });
});
