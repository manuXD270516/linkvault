import { describe, expect, it } from 'vitest';
import { canonicalizeFixtureUrl } from '../../links/application/testing/link-fixtures';
import {
  MOCK_GETONBOARD_HITS,
  MOCK_REMOTEOK_HITS,
} from '../infrastructure/adapters/mock-discovery.adapter';
import { GetonboardDiscoveryAdapter } from '../infrastructure/adapters/getonboard-discovery.adapter';
import {
  RemoteokDiscoveryAdapter,
  type RemoteokDumpRedis,
} from '../infrastructure/adapters/remoteok-discovery.adapter';

describe('discovery hit URLs round-trip canonicalize', () => {
  it('canonicalizes every mock fixture URL', () => {
    for (const hit of MOCK_GETONBOARD_HITS) {
      expect(canonicalizeFixtureUrl(hit.url)).toEqual({
        platform: 'getonboard',
        externalJobId: hit.externalJobId,
      });
    }
    for (const hit of MOCK_REMOTEOK_HITS) {
      expect(canonicalizeFixtureUrl(hit.url)).toEqual({
        platform: 'remoteok',
        externalJobId: hit.externalJobId,
      });
    }
  });

  it('canonicalizes URLs produced by live adapters', async () => {
    const gob = await new GetonboardDiscoveryAdapter({
      httpFetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  attributes: {
                    title: 'QA Engineer',
                    slug: 'qa-engineer-acme-remote-5e6f',
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      userAgent: 'test',
    }).search({
      q: 'qa',
      page: 1,
      pageSize: 10,
      lang: 'es',
      signal: new AbortController().signal,
    });
    expect(gob.kind).toBe('hits');
    if (gob.kind === 'hits') {
      expect(canonicalizeFixtureUrl(gob.hits[0]?.url ?? '')).toEqual({
        platform: 'getonboard',
        externalJobId: 'qa-engineer-acme-remote-5e6f',
      });
    }

    const redis: RemoteokDumpRedis = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
    };
    const rok = await new RemoteokDiscoveryAdapter({
      httpFetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { legal: true },
              {
                id: '4242',
                position: 'Staff Engineer',
                company: 'Nova',
                slug: '4242-staff-engineer-nova',
              },
            ]),
            { status: 200 },
          ),
        ),
      userAgent: 'test',
      redis,
      egress: { tryAcquire: () => Promise.resolve(true) },
      sleep: () => Promise.resolve(),
    }).search({
      q: '',
      page: 1,
      pageSize: 10,
      lang: 'en',
      signal: new AbortController().signal,
    });
    expect(rok.kind).toBe('hits');
    if (rok.kind === 'hits') {
      expect(canonicalizeFixtureUrl(rok.hits[0]?.url ?? '')).toEqual({
        platform: 'remoteok',
        externalJobId: '4242',
      });
    }
  });
});
