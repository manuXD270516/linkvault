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
import { rootCertificates } from 'node:tls';
import { generate } from 'selfsigned';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  LOOPBACK_BY_NAME_TEST_POLICY,
  PERMISSIVE_TEST_POLICY,
  PUBLIC_WITH_ANY_PORT_TEST_POLICY,
} from '../../test-support/egress-policies';
import { PUBLIC_EGRESS_POLICY } from '@linkvault/shared/net';
import { EgressBlockedError, findEgressBlocked } from './egress-blocked-error';
import { createEgressLookup, type EgressResolver } from './egress-lookup';
import { createHttpRobotsFetcher } from '../../modules/enrichment/infrastructure/robots/http-robots-fetcher';
import { RedisCachedRobots } from '../../modules/enrichment/infrastructure/robots/redis-cached-robots';
import { createGuardedConnector } from './guarded-connector';
import { createGuardedFetch, type GuardedFetch } from './guarded-fetch';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

interface CountingServer {
  readonly port: number;
  connections(): number;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

function register(server: Server, fetcher?: GuardedFetch): void {
  cleanups.push(async () => {
    await fetcher?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
}

async function startServer(
  handler: Handler,
  host = '127.0.0.1',
  port = 0,
): Promise<CountingServer> {
  let count = 0;
  const server = createHttpServer(handler);
  server.on('connection', () => {
    count += 1;
  });
  server.listen(port, host);
  await once(server, 'listening');
  register(server);
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => count,
  };
}

const ok: Handler = (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
};

/** Resolvedor que mapea nombres de `.test` a direcciones y cuenta las llamadas; lo demás es `ENOTFOUND`. */
function fakeResolver(table: Record<string, string[]>): EgressResolver & {
  calls(): number;
} {
  let calls = 0;
  const resolver = (hostname: string): Promise<LookupAddress[]> => {
    calls += 1;
    const addresses = table[hostname];
    if (addresses === undefined) {
      const failure: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      failure.code = 'ENOTFOUND';
      return Promise.reject(failure);
    }
    return Promise.resolve(
      addresses.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      })),
    );
  };
  return Object.assign(resolver, { calls: () => calls });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the request to fail');
}

function causeCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === 'string') return code;
    current = current.cause;
  }
  return undefined;
}

function guarded(
  options: Parameters<typeof createGuardedFetch>[0],
): GuardedFetch {
  const fetcher = createGuardedFetch(options);
  cleanups.push(() => fetcher.close());
  return fetcher;
}

const GET = { method: 'GET', headers: {} } as const;

describe('createGuardedFetch: rejections before connecting', () => {
  it('a name resolving to loopback opens no connection', async () => {
    const server = await startServer(ok);
    const resolver = fakeResolver({ 'jobs.test': ['127.0.0.1'] });
    const fetcher = guarded({
      policy: PUBLIC_WITH_ANY_PORT_TEST_POLICY,
      resolve: resolver,
    });
    const error = await failureOf(
      fetcher(`http://jobs.test:${server.port}/`, GET),
    );
    expect(findEgressBlocked(error)).toBeInstanceOf(EgressBlockedError);
    expect(findEgressBlocked(error)?.category).toBe('loopback');
    expect(server.connections()).toBe(0);
  });

  it('a literal loopback host opens no connection', async () => {
    const server = await startServer(ok);
    const fetcher = guarded({ policy: PUBLIC_WITH_ANY_PORT_TEST_POLICY });
    const error = await failureOf(
      fetcher(`http://127.0.0.1:${server.port}/`, GET),
    );
    expect(findEgressBlocked(error)?.category).toBe('loopback');
    expect(server.connections()).toBe(0);
  });

  it('a dotless host is rejected without resolving', async () => {
    const resolver = fakeResolver({ intranet: ['127.0.0.1'] });
    const fetcher = guarded({
      policy: PUBLIC_WITH_ANY_PORT_TEST_POLICY,
      resolve: resolver,
    });
    const error = await failureOf(fetcher('http://intranet:8080/', GET));
    expect(findEgressBlocked(error)?.category).toBe('dotless');
    expect(resolver.calls()).toBe(0);
  });

  it('a non-web port opens no connection', async () => {
    const server = await startServer(ok);
    const resolver = fakeResolver({ 'jobs.test': ['127.0.0.1'] });
    const fetcher = guarded({
      policy: PUBLIC_EGRESS_POLICY,
      resolve: resolver,
    });
    const error = await failureOf(
      fetcher(`http://jobs.test:${server.port}/`, GET),
    );
    expect(findEgressBlocked(error)?.category).toBe('port');
    expect(resolver.calls()).toBe(0);
    expect(server.connections()).toBe(0);
  });

  it('with the public policy a default-port name reaches the resolver', async () => {
    const resolver = fakeResolver({});
    const fetcher = guarded({
      policy: PUBLIC_EGRESS_POLICY,
      resolve: resolver,
    });
    const error = await failureOf(fetcher('http://missing.test/', GET));
    expect(resolver.calls()).toBe(1);
    expect(findEgressBlocked(error)).toBeNull();
    expect(causeCode(error)).toBe('ENOTFOUND');
  });

  it('with a permissive test policy a loopback page is fetched over exactly one connection', async () => {
    const server = await startServer(ok);
    const resolver = fakeResolver({ 'jobs.test': ['127.0.0.1'] });
    const fetcher = guarded({
      policy: PERMISSIVE_TEST_POLICY,
      resolve: resolver,
    });
    const response = await fetcher(`http://jobs.test:${server.port}/`, GET);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(server.connections()).toBe(1);
  });
});

describe('createGuardedFetch: redirects and environment', () => {
  it('a followed redirect to a literal loopback opens no connection', async () => {
    const target = await startServer(ok);
    const first = await startServer((_request, response) => {
      response.writeHead(302, {
        location: `http://127.0.0.1:${target.port}/`,
      });
      response.end();
    });
    const fetcher = guarded({
      policy: LOOPBACK_BY_NAME_TEST_POLICY,
      resolve: fakeResolver({ 'jobs.test': ['127.0.0.1'] }),
    });
    // El llamador pide `follow`; el guardia lo fuerza a `manual` y el salto lo sigue el llamador, a mano.
    const hop = await fetcher(`http://jobs.test:${first.port}/`, {
      method: 'GET',
      redirect: 'follow',
    });
    expect(hop.status).toBe(302);
    const location = hop.headers.get('location');
    expect(location).toBe(`http://127.0.0.1:${target.port}/`);
    const error = await failureOf(fetcher(location ?? '', GET));
    expect(findEgressBlocked(error)).toBeInstanceOf(EgressBlockedError);
    expect(findEgressBlocked(error)?.category).toBe('loopback');
    expect(first.connections()).toBe(1);
    expect(target.connections()).toBe(0);
  });

  it('forces manual redirects whatever the caller asks', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(301, { location: '/elsewhere' });
      response.end();
    });
    const fetcher = guarded({
      policy: PERMISSIVE_TEST_POLICY,
      resolve: fakeResolver({ 'jobs.test': ['127.0.0.1'] }),
    });
    for (const redirect of ['follow', 'error', 'manual'] as const) {
      const response = await fetcher(`http://jobs.test:${server.port}/`, {
        method: 'GET',
        redirect,
      });
      expect(response.status, redirect).toBe(301);
    }
  });

  it('ignores proxy variables in the environment', async () => {
    const target = await startServer(ok);
    const proxy = await startServer((_request, response) => {
      response.writeHead(502);
      response.end();
    });
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    for (const name of [
      'HTTP_PROXY',
      'http_proxy',
      'HTTPS_PROXY',
      'https_proxy',
    ]) {
      vi.stubEnv(name, proxyUrl);
    }
    vi.stubEnv('NO_PROXY', '');
    const fetcher = guarded({
      policy: PERMISSIVE_TEST_POLICY,
      resolve: fakeResolver({ 'jobs.test': ['127.0.0.1'] }),
    });
    const response = await fetcher(`http://jobs.test:${target.port}/`, GET);
    expect(response.status).toBe(200);
    expect(proxy.connections()).toBe(0);
    expect(target.connections()).toBe(1);
  });
});

describe('createGuardedFetch: TLS', () => {
  let cert = '';
  let key = '';

  beforeAll(async () => {
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
    cert = pems.cert;
    key = pems.private;
  });

  async function startTlsServer(): Promise<CountingServer> {
    let count = 0;
    const server = createHttpsServer({ key, cert }, ok);
    server.on('connection', () => {
      count += 1;
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    register(server);
    return {
      port: (server.address() as AddressInfo).port,
      connections: () => count,
    };
  }

  it('trusts a self-signed test server only through the given ca', async () => {
    const server = await startTlsServer();
    const fetcher = guarded({
      policy: PERMISSIVE_TEST_POLICY,
      resolve: fakeResolver({ 'secure.test': ['127.0.0.1'] }),
      tls: { ca: cert },
    });
    const response = await fetcher(`https://secure.test:${server.port}/`, GET);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(server.connections()).toBe(1);
  });

  it('rejects a self-signed server when no ca is given', async () => {
    const server = await startTlsServer();
    const fetcher = guarded({
      policy: PERMISSIVE_TEST_POLICY,
      resolve: fakeResolver({ 'secure.test': ['127.0.0.1'] }),
    });
    const error = await failureOf(
      fetcher(`https://secure.test:${server.port}/`, GET),
    );
    expect(findEgressBlocked(error)).toBeNull();
    expect(causeCode(error)).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY/);
  });

  it('keeps the system roots when a test ca is given', () => {
    const captured: Array<Record<string, unknown>> = [];
    const buildConnector = ((options: Record<string, unknown>) => {
      captured.push(options);
      return () => undefined;
    }) as unknown as Parameters<
      typeof createGuardedConnector
    >[0]['buildConnector'];
    createGuardedConnector({
      policy: PERMISSIVE_TEST_POLICY,
      lookup: createEgressLookup(fakeResolver({}), PERMISSIVE_TEST_POLICY),
      ca: cert,
      buildConnector,
    });
    const ca = captured[0]?.['ca'];
    expect(Array.isArray(ca)).toBe(true);
    const list = ca as string[];
    expect(list).toContain(cert);
    for (const root of rootCertificates) {
      expect(list).toContain(root);
    }
    // Sin `ca` no se pasa ninguna opción de confianza: quedan las raíces por defecto.
    createGuardedConnector({
      policy: PERMISSIVE_TEST_POLICY,
      lookup: createEgressLookup(fakeResolver({}), PERMISSIVE_TEST_POLICY),
      buildConnector,
    });
    expect(captured[1]).not.toHaveProperty('ca');
  });
});

describe('createGuardedFetch: DNS changes between check and connect', () => {
  let aliasesAvailable = true;

  beforeAll(async () => {
    // En Linux (CI) todo 127.0.0.0/8 es local; en otros sistemas puede no serlo (design R10).
    const probe = createHttpServer();
    probe.listen(0, '127.0.0.3');
    try {
      await once(probe, 'listening');
    } catch {
      aliasesAvailable = false;
      if (process.env['CI'] !== undefined) {
        throw new Error('127.0.0.2/127.0.0.3 must be available in CI');
      }
    } finally {
      probe.close();
    }
  });

  it('connects to the address approved in the same resolution', async (context) => {
    if (!aliasesAvailable) context.skip();
    const approved = await startServer(ok, '127.0.0.2');
    const other = await startServer(ok, '127.0.0.3', approved.port);
    let calls = 0;
    const resolver: EgressResolver = () => {
      calls += 1;
      return Promise.resolve([
        { address: calls === 1 ? '127.0.0.2' : '127.0.0.3', family: 4 },
      ]);
    };
    const fetcher = guarded({
      policy: LOOPBACK_BY_NAME_TEST_POLICY,
      resolve: resolver,
    });
    const response = await fetcher(`http://jobs.test:${approved.port}/`, GET);
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    expect(approved.connections()).toBe(1);
    expect(other.connections()).toBe(0);
  });

  it('a later hop resolving to a private address opens no connection', async (context) => {
    if (!aliasesAvailable) context.skip();
    const hopOne = await startServer((_request, response) => {
      response.writeHead(302, { location: '/next', connection: 'close' });
      response.end();
    }, '127.0.0.2');
    let calls = 0;
    const resolver: EgressResolver = () => {
      calls += 1;
      return Promise.resolve([
        { address: calls === 1 ? '127.0.0.2' : '10.0.0.5', family: 4 },
      ]);
    };
    const fetcher = guarded({
      policy: LOOPBACK_BY_NAME_TEST_POLICY,
      resolve: resolver,
    });
    const url = `http://jobs.test:${hopOne.port}/`;
    const first = await fetcher(url, GET);
    expect(first.status).toBe(302);
    // Las redirecciones las sigue el llamador, a mano, dentro del mismo host.
    const error = await failureOf(fetcher(new URL('/next', url).href, GET));
    expect(findEgressBlocked(error)).toBeInstanceOf(EgressBlockedError);
    expect(findEgressBlocked(error)?.category).toBe('private');
    expect(hopOne.connections()).toBe(1);
    expect(calls).toBe(2);
  });
});

describe('createGuardedFetch: robots.txt redirects', () => {
  const NO_CACHE = {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve('OK' as const),
  };

  function robotsOver(
    fetcher: GuardedFetch,
    logged: Record<string, string>[],
  ): RedisCachedRobots {
    return new RedisCachedRobots(
      NO_CACHE,
      createHttpRobotsFetcher(fetcher, {
        userAgent: 'LinkVaultBot/0.1',
        timeoutMs: 5_000,
        logger: { warn: (entry) => logged.push(entry) },
      }),
      { userAgent: 'LinkVaultBot/0.1', ttlSeconds: 60 },
    );
  }

  it('a robots redirect to an internal address opens no connection to it', async () => {
    const target = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *\nDisallow: /');
    });
    const origin = await startServer((_request, response) => {
      response.writeHead(302, {
        location: `http://127.0.0.1:${target.port}/robots.txt`,
      });
      response.end();
    });
    const logged: Record<string, string>[] = [];
    const fetcher = guarded({
      policy: LOOPBACK_BY_NAME_TEST_POLICY,
      resolve: fakeResolver({ 'jobs.test': ['127.0.0.1'] }),
    });

    const decision = await robotsOver(fetcher, logged).decide(
      `http://jobs.test:${origin.port}/oferta`,
    );

    // El destino interno no se pidió; sin reglas, la página se considera permitida (y tiene su propio filtro).
    expect(decision.allowed).toBe(true);
    expect(origin.connections()).toBe(1);
    expect(target.connections()).toBe(0);
    expect(logged).toEqual([
      { event: 'egress_blocked', stage: 'robots', category: 'loopback' },
    ]);
  });

  it('a robots redirect to an approved host opens exactly one connection to it', async () => {
    const target = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *\nDisallow: /privado');
    });
    const origin = await startServer((_request, response) => {
      response.writeHead(302, {
        location: `http://cdn.test:${target.port}/robots.txt`,
      });
      response.end();
    });
    const logged: Record<string, string>[] = [];
    const fetcher = guarded({
      policy: PERMISSIVE_TEST_POLICY,
      resolve: fakeResolver({
        'jobs.test': ['127.0.0.1'],
        'cdn.test': ['127.0.0.1'],
      }),
    });

    const decision = await robotsOver(fetcher, logged).decide(
      `http://jobs.test:${origin.port}/privado/oferta`,
    );

    expect(decision.allowed).toBe(false);
    expect(target.connections()).toBe(1);
    expect(logged).toEqual([]);
  });
});
