import { describe, expect, it } from 'vitest';
import { EgressBlockedError } from '../../../../infrastructure/egress/egress-blocked-error';
import type { HttpFetch } from '../http/http-page-fetcher';
import {
  ROBOTS_MAX_BYTES,
  createHttpRobotsFetcher,
} from './http-robots-fetcher';

// D5 de enrichment-egress-guard: redirecciones a mano (hasta cinco), a otro host solo hacia `/robots.txt` sin query, y
// lectura por trozos con tope. Ningún test toca la red: el `HttpFetch` es un doble por URL.

const USER_AGENT =
  'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)';

type Step = () => Response | Promise<Response>;

function redirect(location: string, status = 302): Step {
  return () => new Response(null, { status, headers: { location } });
}

function rules(body: string): Step {
  return () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
}

/** Doble que responde por URL y recuerda cada petición. */
function httpFetchOf(
  steps: Record<string, Step>,
): HttpFetch & { requested: string[] } {
  const requested: string[] = [];
  const httpFetch: HttpFetch = (url) => {
    requested.push(url);
    const step = steps[url];
    if (step === undefined) {
      return Promise.reject(new Error(`unexpected request to ${url}`));
    }
    return Promise.resolve(step());
  };
  return Object.assign(httpFetch, { requested });
}

function warnings(): {
  entries: unknown[];
  logger: { warn: (entry: Record<string, string>) => void };
} {
  const entries: unknown[] = [];
  return { entries, logger: { warn: (entry) => entries.push(entry) } };
}

function fetcherOver(
  httpFetch: HttpFetch,
  logger: { warn: (entry: Record<string, string>) => void } = {
    warn: () => undefined,
  },
) {
  return createHttpRobotsFetcher(httpFetch, {
    userAgent: USER_AGENT,
    timeoutMs: 1_000,
    logger,
  });
}

/** Cadena `/r0 -> /r1 -> ... -> /r<hops>` dentro del mismo host, que termina en reglas. */
function chainOf(hops: number): Record<string, Step> {
  const steps: Record<string, Step> = {};
  for (let i = 0; i < hops; i += 1) {
    steps[`https://bolsa.example/r${i}`] = redirect(`/r${i + 1}`);
  }
  steps[`https://bolsa.example/r${hops}`] = rules('User-agent: *\nAllow: /');
  return steps;
}

describe('Redirecciones del robots.txt', () => {
  it('follows up to five redirects', async () => {
    const httpFetch = httpFetchOf(chainOf(5));

    const response = await fetcherOver(httpFetch)('https://bolsa.example/r0');

    expect(response?.status).toBe(200);
    expect(response?.body).toContain('Allow: /');
    expect(httpFetch.requested).toHaveLength(6);
  });

  it('does not request a sixth redirect target', async () => {
    const httpFetch = httpFetchOf(chainOf(6));

    const response = await fetcherOver(httpFetch)('https://bolsa.example/r0');

    expect(response).toBeNull();
    expect(httpFetch.requested).not.toContain('https://bolsa.example/r6');
    expect(httpFetch.requested).toHaveLength(6);
  });

  it('follows a redirect to robots.txt on another public host and returns its rules', async () => {
    const httpFetch = httpFetchOf({
      'https://bolsa.example/robots.txt': redirect(
        'https://cdn.bolsa-ejemplo.example/robots.txt',
        301,
      ),
      'https://cdn.bolsa-ejemplo.example/robots.txt': rules(
        'User-agent: *\nDisallow: /privado',
      ),
    });

    const response = await fetcherOver(httpFetch)(
      'https://bolsa.example/robots.txt',
    );

    expect(response?.body).toContain('Disallow: /privado');
    expect(httpFetch.requested).toEqual([
      'https://bolsa.example/robots.txt',
      'https://cdn.bolsa-ejemplo.example/robots.txt',
    ]);
  });

  it('does not follow a cross-host redirect to another path or with a query', async () => {
    for (const target of [
      'https://otro.example/admin',
      'https://otro.example/robots.txt?x=1',
      'https://otro.example/robots.txt/extra',
    ]) {
      const httpFetch = httpFetchOf({
        'https://bolsa.example/robots.txt': redirect(target),
        [target]: rules('User-agent: *\nAllow: /'),
      });

      const response = await fetcherOver(httpFetch)(
        'https://bolsa.example/robots.txt',
      );

      expect(response, target).toBeNull();
      expect(httpFetch.requested, target).toEqual([
        'https://bolsa.example/robots.txt',
      ]);
    }
  });

  it('returns null when a hop is rejected by the egress guard and logs stage robots without linkId or url', async () => {
    const { entries, logger } = warnings();
    const httpFetch: HttpFetch = (url) =>
      url.endsWith('/robots.txt')
        ? Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: '/internal-hop' },
            }),
          )
        : Promise.reject(
            new TypeError('fetch failed', {
              cause: new EgressBlockedError('private'),
            }),
          );

    const response = await fetcherOver(
      httpFetch,
      logger,
    )('https://bolsa.example/robots.txt');

    expect(response).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ stage: 'robots', category: 'private' });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('linkId');
    expect(serialized).not.toContain('bolsa.example');
    expect(serialized).not.toContain('http');
  });
});

describe('Cuerpo del robots.txt', () => {
  /** Respuesta por trozos que cuenta cuántos entregó, sin `content-length`. */
  function streamed(chunkBytes: number, chunks: number) {
    let delivered = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (delivered >= chunks) {
          controller.close();
          return;
        }
        delivered += 1;
        controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
      },
    });
    return {
      response: new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
      delivered: () => delivered,
    };
  }

  it('stops reading a robots body over the cap without a content-length', async () => {
    const chunkBytes = 65_536;
    const totalChunks = 1_000;
    const body = streamed(chunkBytes, totalChunks);
    const httpFetch = httpFetchOf({
      'https://bolsa.example/robots.txt': () => body.response,
    });

    await fetcherOver(httpFetch)('https://bolsa.example/robots.txt');

    expect(body.delivered()).toBeLessThan(totalChunks);
    // Se leyó lo justo para pasar el tope, no el flujo entero.
    expect(body.delivered() * chunkBytes).toBeLessThan(ROBOTS_MAX_BYTES * 4);
  });

  it('returns no rules for an oversized robots body', async () => {
    const body = streamed(65_536, 20);
    const httpFetch = httpFetchOf({
      'https://bolsa.example/robots.txt': () => body.response,
    });

    const response = await fetcherOver(httpFetch)(
      'https://bolsa.example/robots.txt',
    );

    expect(response).toEqual({
      status: 200,
      contentType: 'text/plain',
      body: '',
    });
  });
});
