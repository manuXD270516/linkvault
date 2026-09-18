import { describe, expect, it } from 'vitest';
import {
  RedisCachedRobots,
  robotsCacheKey,
  type RobotsCacheClient,
  type RobotsFetcher,
  type RobotsResponse,
} from './redis-cached-robots';

// Requisito "Cortesía con los sitios" (specs/links/enrichment) y D6 de link-enrichment. Ningún test toca la red: el
// `robots.txt` llega por un doble de `RobotsFetcher` y la caché es un mapa en memoria con la forma de ioredis.

const USER_AGENT =
  'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)';

/** Caché con la forma que usa el adaptador (`get` y `set … EX`), contando lo que se le pide. */
class FakeRedis implements RobotsCacheClient {
  readonly entries = new Map<string, { value: string; ttlSeconds: number }>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key)?.value ?? null);
  }

  set(
    key: string,
    value: string,
    _mode: 'EX',
    ttlSeconds: number,
  ): Promise<'OK'> {
    this.entries.set(key, { value, ttlSeconds });
    return Promise.resolve('OK');
  }
}

/** Doble de la descarga del `robots.txt` que recuerda cuántas veces se le pidió y con qué URL. */
function fetcherOf(
  response: RobotsResponse | null,
): RobotsFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (robotsUrl: string): Promise<RobotsResponse | null> => {
    calls.push(robotsUrl);
    return Promise.resolve(response);
  };
  return Object.assign(fetcher, { calls });
}

function plainText(body: string, status = 200): RobotsResponse {
  return { status, contentType: 'text/plain; charset=utf-8', body };
}

function robotsOf(
  response: RobotsResponse | null,
  cache = new FakeRedis(),
): {
  robots: RedisCachedRobots;
  cache: FakeRedis;
  fetcher: RobotsFetcher & { calls: string[] };
} {
  const fetcher = fetcherOf(response);
  return {
    robots: new RedisCachedRobots(cache, fetcher, {
      userAgent: USER_AGENT,
      ttlSeconds: 43_200,
    }),
    cache,
    fetcher,
  };
}

describe('robots.txt prohíbe la ruta', () => {
  it('denies a path disallowed for our agent', async () => {
    const { robots } = robotsOf(
      plainText('User-agent: LinkVaultBot\nDisallow: /jobs/\n'),
    );

    expect(await robots.decide('https://bolsa.example/jobs/123')).toEqual({
      allowed: false,
      crawlDelayMs: 0,
    });
    // La prohibición es de esa ruta, no del host: otra ruta del mismo sitio sigue permitida.
    expect(await robots.decide('https://bolsa.example/empresa/1')).toEqual({
      allowed: true,
      crawlDelayMs: 0,
    });
  });

  it('falls back to the * group when there is none for our agent', async () => {
    const { robots } = robotsOf(
      plainText(
        'User-agent: *\nDisallow: /viewjob\n\nUser-agent: Googlebot\nDisallow:\n',
      ),
    );

    expect(
      (await robots.decide('https://bolsa.example/viewjob?jk=1')).allowed,
    ).toBe(false);
  });

  it('prefers the group that matches our agent over the * group', async () => {
    // El grupo propio manda entero, también donde es más permisivo que el general.
    const { robots } = robotsOf(
      plainText(
        'User-agent: *\nDisallow: /\n\nUser-agent: LinkVaultBot\nDisallow: /privado\n',
      ),
    );

    expect((await robots.decide('https://bolsa.example/jobs/1')).allowed).toBe(
      true,
    );
    expect(
      (await robots.decide('https://bolsa.example/privado/1')).allowed,
    ).toBe(false);
  });

  it('reads the Crawl-delay of the applicable group, in milliseconds', async () => {
    const { robots } = robotsOf(
      plainText(
        'User-agent: *\nCrawl-delay: 1\n\nUser-agent: LinkVaultBot\nCrawl-delay: 5\n',
      ),
    );

    expect(await robots.decide('https://bolsa.example/jobs/1')).toEqual({
      allowed: true,
      crawlDelayMs: 5_000,
    });
  });
});

describe('robots.txt cacheado', () => {
  it('asks the site for its robots.txt only once for two links of the same host', async () => {
    const { robots, fetcher, cache } = robotsOf(
      plainText('User-agent: *\nDisallow: /jobs/secreto\n'),
    );

    await robots.decide('https://bolsa.example/jobs/1');
    await robots.decide('https://bolsa.example/jobs/2');

    expect(fetcher.calls).toEqual(['https://bolsa.example/robots.txt']);
    expect(cache.entries.get(robotsCacheKey('bolsa.example'))?.ttlSeconds).toBe(
      43_200,
    );
  });

  it('caches the disallow as well, so a forbidden host is not asked twice', async () => {
    const { robots, fetcher } = robotsOf(
      plainText('User-agent: *\nDisallow: /\n'),
    );

    expect(
      (await robots.decide('https://linkedin.example/jobs/1')).allowed,
    ).toBe(false);
    expect(
      (await robots.decide('https://linkedin.example/jobs/2')).allowed,
    ).toBe(false);
    expect(fetcher.calls).toHaveLength(1);
  });

  it('keeps one entry per host', async () => {
    const cache = new FakeRedis();
    const first = robotsOf(plainText('User-agent: *\nDisallow: /\n'), cache);
    await first.robots.decide('https://uno.example/jobs/1');
    const second = robotsOf(plainText('User-agent: *\nDisallow:\n'), cache);
    await second.robots.decide('https://dos.example/jobs/1');

    expect(
      (await second.robots.decide('https://dos.example/jobs/2')).allowed,
    ).toBe(true);
    expect(second.fetcher.calls).toHaveLength(1);
    expect([...cache.entries.keys()]).toEqual([
      robotsCacheKey('uno.example'),
      robotsCacheKey('dos.example'),
    ]);
  });
});

describe('robots.txt que no es texto', () => {
  it('does not read a block page as rules and allows the fetch', async () => {
    // Computrabajo responde `403` con una página de bloqueo al pedirle su `robots.txt`: ni es texto ni es una
    // prohibición, así que no se interpreta.
    const { robots } = robotsOf({
      status: 403,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html><body>Acceso denegado</body></html>',
    });

    expect(
      await robots.decide('https://computrabajo.example/ofertas/1'),
    ).toEqual({
      allowed: true,
      crawlDelayMs: 0,
    });
  });

  it('ignores an HTML body served as text/plain', async () => {
    const { robots } = robotsOf(
      plainText('<html><head><title>Disallow: /</title></head></html>'),
    );

    expect((await robots.decide('https://bolsa.example/jobs/1')).allowed).toBe(
      true,
    );
  });

  it('ignores a robots.txt served as an image', async () => {
    const { robots } = robotsOf({
      status: 200,
      contentType: 'image/png',
      body: 'User-agent: *\nDisallow: /',
    });

    expect((await robots.decide('https://bolsa.example/jobs/1')).allowed).toBe(
      true,
    );
  });
});

describe('robots.txt que no se puede leer', () => {
  it('allows when the site answers 500', async () => {
    const { robots, cache } = robotsOf({
      status: 500,
      contentType: 'text/plain',
      body: 'User-agent: *\nDisallow: /',
    });

    expect(await robots.decide('https://bolsa.example/jobs/1')).toEqual({
      allowed: true,
      crawlDelayMs: 0,
    });
    // También se cachea: repetir la petición a un sitio que está caído no ayuda a nadie.
    expect(cache.entries.get(robotsCacheKey('bolsa.example'))?.value).toBe('');
  });

  it('allows when there is no answer at all', async () => {
    const { robots } = robotsOf(null);

    expect((await robots.decide('https://bolsa.example/jobs/1')).allowed).toBe(
      true,
    );
  });

  it('allows when the fetch throws', async () => {
    const robots = new RedisCachedRobots(
      new FakeRedis(),
      () => Promise.reject(new Error('ECONNRESET')),
      { userAgent: USER_AGENT, ttlSeconds: 43_200 },
    );

    expect((await robots.decide('https://bolsa.example/jobs/1')).allowed).toBe(
      true,
    );
  });

  it('allows when Redis is down, asking the site instead of failing', async () => {
    const broken: RobotsCacheClient = {
      get: () => Promise.reject(new Error('redis down')),
      set: () => Promise.reject(new Error('redis down')),
    };
    const robots = new RedisCachedRobots(
      broken,
      fetcherOf(plainText('User-agent: *\nDisallow: /jobs/\n')),
      { userAgent: USER_AGENT, ttlSeconds: 43_200 },
    );

    expect((await robots.decide('https://bolsa.example/jobs/1')).allowed).toBe(
      false,
    );
  });

  it('allows a URL that is not even a fetchable address', async () => {
    const { robots, fetcher } = robotsOf(
      plainText('User-agent: *\nDisallow: /\n'),
    );

    expect((await robots.decide('mailto:alguien@example.com')).allowed).toBe(
      true,
    );
    expect((await robots.decide('no es una url')).allowed).toBe(true);
    expect(fetcher.calls).toEqual([]);
  });
});
