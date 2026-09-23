import { describe, expect, it, vi } from 'vitest';
import {
  GETONBOARD_API_BASE,
  GETONBOARD_SEARCH_PATH,
  GetonboardDiscoveryAdapter,
  type DiscoveryHttpFetch,
} from './getonboard-discovery.adapter';

const USER_AGENT = 'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)';

interface Attempt {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function fetcherOf(
  responses: Record<string, () => Response>,
): DiscoveryHttpFetch & { attempts: Attempt[] } {
  const attempts: Attempt[] = [];
  const httpFetch: DiscoveryHttpFetch = (url, init) => {
    attempts.push({ url, headers: init.headers });
    const build = responses[url];
    if (build === undefined) {
      return Promise.reject(new Error(`unexpected request to ${url}`));
    }
    return Promise.resolve(build());
  };
  return Object.assign(httpFetch, { attempts });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function searchUrl(query: Record<string, string>): string {
  const url = new URL(GETONBOARD_SEARCH_PATH, GETONBOARD_API_BASE);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

describe('GetonboardDiscoveryAdapter', () => {
  it('maps JSON:API hits to canonical getonboard URLs', async () => {
    const url = searchUrl({
      query: 'react',
      page: '1',
      per_page: '10',
      lang: 'es',
    });
    const httpFetch = fetcherOf({
      [url]: () =>
        new Response(
          JSON.stringify({
            data: [
              {
                attributes: {
                  title: 'React Developer',
                  slug: 'react-developer-acme-santiago-2b3c',
                  company_name: 'Acme',
                  modality: 'hybrid',
                  min_salary: 3000,
                  max_salary: 4500,
                  currency: 'usd',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const result = await new GetonboardDiscoveryAdapter({
      httpFetch,
      userAgent: USER_AGENT,
    }).search({
      q: 'react',
      page: 1,
      pageSize: 10,
      lang: 'es',
      signal: signal(),
    });

    expect(result).toEqual({
      kind: 'hits',
      hits: [
        {
          board: 'getonboard',
          title: 'React Developer',
          company: 'Acme',
          location: 'hybrid',
          url: 'https://www.getonbrd.com/jobs/react-developer-acme-santiago-2b3c',
          externalJobId: 'react-developer-acme-santiago-2b3c',
          salaryText: 'USD 3000–4500',
        },
      ],
    });
    expect(httpFetch.attempts[0]?.headers['user-agent']).toBe(USER_AGENT);
  });

  it('omits query when q is empty', async () => {
    const url = searchUrl({ page: '1', per_page: '5', lang: 'en' });
    const httpFetch = fetcherOf({
      [url]: () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    await new GetonboardDiscoveryAdapter({
      httpFetch,
      userAgent: USER_AGENT,
    }).search({
      q: '  ',
      page: 1,
      pageSize: 5,
      lang: 'en',
      signal: signal(),
    });

    expect(httpFetch.attempts[0]?.url).toBe(url);
    expect(httpFetch.attempts[0]?.url).not.toContain('query=');
  });

  it.each([
    [429, 'upstream_429'],
    [503, 'upstream_5xx'],
  ] as const)('degrades on HTTP %s', async (status, reason) => {
    const url = searchUrl({
      query: 'x',
      page: '1',
      per_page: '10',
      lang: 'es',
    });
    const httpFetch = fetcherOf({
      [url]: () => new Response('', { status }),
    });

    const result = await new GetonboardDiscoveryAdapter({
      httpFetch,
      userAgent: USER_AGENT,
    }).search({
      q: 'x',
      page: 1,
      pageSize: 10,
      lang: 'es',
      signal: signal(),
    });

    expect(result).toEqual({ kind: 'degraded', reason });
  });

  it('degrades on network failure', async () => {
    const httpFetch: DiscoveryHttpFetch = () =>
      Promise.reject(new TypeError('fetch failed'));

    const result = await new GetonboardDiscoveryAdapter({
      httpFetch,
      userAgent: USER_AGENT,
    }).search({
      q: 'x',
      page: 1,
      pageSize: 10,
      lang: 'es',
      signal: signal(),
    });

    expect(result).toEqual({ kind: 'degraded', reason: 'network' });
  });

  it('degrades on abort', async () => {
    const httpFetch: DiscoveryHttpFetch = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    };

    const result = await new GetonboardDiscoveryAdapter({
      httpFetch,
      userAgent: USER_AGENT,
    }).search({
      q: 'x',
      page: 1,
      pageSize: 10,
      lang: 'es',
      signal: AbortSignal.abort(),
    });

    expect(result).toEqual({ kind: 'degraded', reason: 'timeout' });
  });

  // El "nock" aquí es el doble de fetch inyectado (mismo patrón enrichment): no se toca la red.
  it('never calls unexpected hosts', async () => {
    const spy = vi.fn(() =>
      Promise.reject(new Error('should not fetch')),
    ) as DiscoveryHttpFetch;
    // URL que no coincide con el registry del doble → falla network, sin red real.
    const result = await new GetonboardDiscoveryAdapter({
      httpFetch: spy,
      userAgent: USER_AGENT,
      baseUrl: 'https://www.getonbrd.com',
    }).search({
      q: 'x',
      page: 1,
      pageSize: 10,
      lang: 'es',
      signal: signal(),
    });
    expect(result.kind).toBe('degraded');
    expect(spy).toHaveBeenCalledOnce();
  });
});
