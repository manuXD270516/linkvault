import { once } from 'node:events';
import type { LookupAddress } from 'node:dns';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { generate } from 'selfsigned';
import { afterEach, describe, expect, it } from 'vitest';
import type { EgressResolver } from '../../../../infrastructure/egress/egress-lookup';
import {
  createGuardedFetch,
  type GuardedFetch,
} from '../../../../infrastructure/egress/guarded-fetch';
import {
  PERMISSIVE_TEST_POLICY,
  PUBLIC_WITH_ANY_PORT_TEST_POLICY,
} from '../../../../test-support/egress-policies';
import { HttpPageFetcher } from './http-page-fetcher';

// Fetcher real sobre el guardia real (E8, B7 del debate de enrichment-egress-guard): lo que los dobles de `HttpFetch`
// no prueban es la traducción de los errores reales del cliente. Servidores locales que cuentan conexiones y un
// resolvedor inyectado que mapea nombres de `.test`.

const PAGE = '<html><head><title>Oferta</title></head><body>Hola</body></html>';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

interface CountingServer {
  readonly port: number;
  connections(): number;
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servePage: Handler = (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(PAGE);
};

function track(server: Server): CountingServer {
  let count = 0;
  server.on('connection', () => {
    count += 1;
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => count,
  };
}

async function startHttp(handler: Handler): Promise<CountingServer> {
  const server = createHttpServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return track(server);
}

function resolverOf(table: Record<string, string[]>): EgressResolver {
  return (hostname) => {
    const addresses = table[hostname];
    if (addresses === undefined) {
      const failure: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      failure.code = 'ENOTFOUND';
      return Promise.reject(failure);
    }
    return Promise.resolve<LookupAddress[]>(
      addresses.map((address) => ({ address, family: 4 })),
    );
  };
}

function pageFetcherOver(guarded: GuardedFetch): HttpPageFetcher {
  cleanups.push(() => guarded.close());
  return new HttpPageFetcher(guarded, {
    userAgent: 'LinkVaultBot/0.1 (+https://example.test/bot)',
    timeoutMs: 5_000,
    maxBytes: 100_000,
  });
}

describe('HttpPageFetcher sobre el guardia real', () => {
  it('a host resolving to a blocked address ends in unsafe_destination with no connection', async () => {
    const server = await startHttp(servePage);
    const fetcher = pageFetcherOver(
      createGuardedFetch({
        policy: PUBLIC_WITH_ANY_PORT_TEST_POLICY,
        resolve: resolverOf({ 'jobs.test': ['127.0.0.1'] }),
      }),
    );

    const result = await fetcher.fetchPage(
      `http://jobs.test:${server.port}/oferta`,
    );

    expect(result).toEqual({
      ok: false,
      reason: 'unsafe_destination',
      category: 'loopback',
    });
    expect(server.connections()).toBe(0);
  });

  it('a name that does not resolve ends in http_error', async () => {
    const fetcher = pageFetcherOver(
      createGuardedFetch({
        policy: PUBLIC_WITH_ANY_PORT_TEST_POLICY,
        resolve: resolverOf({}),
      }),
    );

    const result = await fetcher.fetchPage('http://missing.test/oferta');

    expect(result).toEqual({ ok: false, reason: 'http_error' });
  });

  it('an approved host is fetched over exactly one connection', async () => {
    const server = await startHttp(servePage);
    const fetcher = pageFetcherOver(
      createGuardedFetch({
        policy: PERMISSIVE_TEST_POLICY,
        resolve: resolverOf({ 'jobs.test': ['127.0.0.1'] }),
      }),
    );

    const result = await fetcher.fetchPage(
      `http://jobs.test:${server.port}/oferta`,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain('Oferta');
    expect(server.connections()).toBe(1);
  });

  it('an approved https host is fetched over exactly one connection', async () => {
    const pems = await generate(
      [{ name: 'commonName', value: 'secure.test' }],
      {
        algorithm: 'sha256',
        extensions: [
          {
            name: 'subjectAltName',
            altNames: [{ type: 2, value: 'secure.test' }],
          },
        ],
      },
    );
    const server = createHttpsServer(
      { key: pems.private, cert: pems.cert },
      servePage,
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const counting = track(server);
    const fetcher = pageFetcherOver(
      createGuardedFetch({
        policy: PERMISSIVE_TEST_POLICY,
        resolve: resolverOf({ 'secure.test': ['127.0.0.1'] }),
        tls: { ca: pems.cert },
      }),
    );

    const result = await fetcher.fetchPage(
      `https://secure.test:${counting.port}/oferta`,
    );

    expect(result.ok).toBe(true);
    expect(counting.connections()).toBe(1);
  });
});
