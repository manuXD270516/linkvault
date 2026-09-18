import { describe, expect, it } from 'vitest';
import {
  HttpPageFetcher,
  MAX_REDIRECTS,
  type HttpFetch,
} from './http-page-fetcher';

// Requisito "Cortesía con los sitios" (specs/links/enrichment) y D6 de link-enrichment. Ningún test toca la red: el
// doble de `HttpFetch` devuelve `Response` construidos a mano, con su cuerpo por trozos cuando hace falta medirlo.

const USER_AGENT =
  'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)';

const MAX_BYTES = 4_096;

interface Attempt {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Doble que responde por URL y recuerda cada petición, para poder afirmar qué se pidió y qué no. */
function fetcherOf(
  responses: Record<string, () => Response>,
  fallback?: () => Response,
): HttpFetch & { attempts: Attempt[] } {
  const attempts: Attempt[] = [];
  const httpFetch: HttpFetch = (url, init) => {
    attempts.push({ url, headers: init.headers });
    const build = responses[url] ?? fallback;
    if (build === undefined) {
      return Promise.reject(new Error(`unexpected request to ${url}`));
    }
    return Promise.resolve(build());
  };
  return Object.assign(httpFetch, { attempts });
}

function pageFetcherOf(
  httpFetch: HttpFetch,
  timeoutMs = 1_000,
): HttpPageFetcher {
  return new HttpPageFetcher(httpFetch, {
    userAgent: USER_AGENT,
    timeoutMs,
    maxBytes: MAX_BYTES,
  });
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

/** Respuesta cuyo cuerpo llega por trozos: es la única forma de comprobar que el tope corta el flujo. */
function streamed(
  chunkBytes: number,
  chunks: number,
  headers: Record<string, string> = {},
): { response: Response; delivered: () => number; cancelled: () => boolean } {
  let delivered = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (delivered >= chunks) {
        controller.close();
        return;
      }
      delivered += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/html', ...headers },
    }),
    delivered: () => delivered,
    cancelled: () => cancelled,
  };
}

describe('Descarga de la página', () => {
  it('identifies itself and returns the decoded HTML', async () => {
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () =>
        html('<html><h1>Oferta</h1></html>'),
    });

    const result = await pageFetcherOf(httpFetch).fetchPage(
      'https://bolsa.example/jobs/1',
    );

    expect(result).toEqual({
      ok: true,
      html: '<html><h1>Oferta</h1></html>',
      finalUrl: 'https://bolsa.example/jobs/1',
    });
    expect(httpFetch.attempts[0].headers['user-agent']).toBe(USER_AGENT);
  });

  it('decodes the charset the site declares', async () => {
    const latin1 = new Uint8Array([
      0x3c, 0x70, 0x3e, 0x53, 0x65, 0x6e, 0x69, 0x6f, 0x72, 0x20, 0x49, 0x6e,
      0x67, 0x65, 0x6e, 0x69, 0x65, 0x72, 0xed, 0x61, 0x3c, 0x2f, 0x70, 0x3e,
    ]);
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () =>
        new Response(latin1, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=iso-8859-1' },
        }),
    });

    const result = await pageFetcherOf(httpFetch).fetchPage(
      'https://bolsa.example/jobs/1',
    );

    expect(result).toEqual({
      ok: true,
      html: '<p>Senior Ingeniería</p>',
      finalUrl: 'https://bolsa.example/jobs/1',
    });
  });

  it('refuses an address that is not http(s) without asking anyone', async () => {
    const httpFetch = fetcherOf({});

    expect(
      await pageFetcherOf(httpFetch).fetchPage('file:///etc/passwd'),
    ).toEqual({ ok: false, reason: 'http_error' });
    expect(httpFetch.attempts).toEqual([]);
  });
});

describe('Respuesta que no es HTML', () => {
  it('does not try to extract anything from a PDF', async () => {
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1.pdf': () =>
        new Response('%PDF-1.7', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
    });

    expect(
      await pageFetcherOf(httpFetch).fetchPage(
        'https://bolsa.example/jobs/1.pdf',
      ),
    ).toEqual({ ok: false, reason: 'not_html' });
  });

  it('does not try to extract anything from an image', async () => {
    const httpFetch = fetcherOf({
      'https://bolsa.example/oferta.png': () =>
        new Response(new Uint8Array([0x89, 0x50]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    });

    expect(
      await pageFetcherOf(httpFetch).fetchPage(
        'https://bolsa.example/oferta.png',
      ),
    ).toEqual({ ok: false, reason: 'not_html' });
  });

  it('accepts xhtml, which is a page like any other', async () => {
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () =>
        new Response('<html/>', {
          status: 200,
          headers: { 'content-type': 'application/xhtml+xml' },
        }),
    });

    expect(
      (await pageFetcherOf(httpFetch).fetchPage('https://bolsa.example/jobs/1'))
        .ok,
    ).toBe(true);
  });
});

describe('Página demasiado grande o demasiado lenta', () => {
  it('gives up on a body larger than the limit, cutting the stream', async () => {
    const { response, delivered, cancelled } = streamed(1_024, 100);
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () => response,
    });

    expect(
      await pageFetcherOf(httpFetch).fetchPage('https://bolsa.example/jobs/1'),
    ).toEqual({ ok: false, reason: 'too_large' });
    // Se abandona en cuanto se pasa del tope: no se leen los 100 KiB que el sitio quería mandar.
    expect(delivered()).toBeLessThan(10);
    expect(cancelled()).toBe(true);
  });

  it('gives up before reading when the site declares a size over the limit', async () => {
    const { response, delivered, cancelled } = streamed(1_024, 100, {
      'content-length': String(MAX_BYTES + 1),
    });
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () => response,
    });

    expect(
      await pageFetcherOf(httpFetch).fetchPage('https://bolsa.example/jobs/1'),
    ).toEqual({ ok: false, reason: 'too_large' });
    expect(cancelled()).toBe(true);
    // El único trozo entregado es el que el propio `ReadableStream` adelanta al crearse; nadie lo llegó a leer.
    expect(delivered()).toBeLessThanOrEqual(1);
  });

  it('accepts a body that fits exactly', async () => {
    const { response } = streamed(1_024, 4);
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () => response,
    });

    const result = await pageFetcherOf(httpFetch).fetchPage(
      'https://bolsa.example/jobs/1',
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toHaveLength(MAX_BYTES);
  });

  it('gives up on a page that never answers', async () => {
    // El doble solo resuelve cuando el plazo aborta la petición, que es lo que hace un sitio colgado.
    const httpFetch: HttpFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });

    expect(
      await pageFetcherOf(httpFetch, 20).fetchPage(
        'https://bolsa.example/jobs/1',
      ),
    ).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('Respuestas del sitio que no son nuestras', () => {
  it('tells apart the site blocking us from a page that is not there', async () => {
    const cases: [number, string][] = [
      [401, 'blocked'],
      [403, 'blocked'],
      [429, 'rate_limited'],
      [404, 'http_error'],
      [500, 'http_error'],
    ];

    for (const [status, reason] of cases) {
      const httpFetch = fetcherOf({
        'https://bolsa.example/jobs/1': () =>
          new Response('<html>no</html>', {
            status,
            headers: { 'content-type': 'text/html' },
          }),
      });

      expect(
        await pageFetcherOf(httpFetch).fetchPage(
          'https://bolsa.example/jobs/1',
        ),
      ).toEqual({ ok: false, reason });
    }
  });
});

describe('Redirecciones', () => {
  it('follows redirects inside the same host up to the limit', async () => {
    const hops: Record<string, () => Response> = {};
    for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
      hops[`https://bolsa.example/jobs/${hop}`] = () =>
        new Response(null, {
          status: 301,
          headers: { location: `/jobs/${hop + 1}` },
        });
    }
    hops[`https://bolsa.example/jobs/${MAX_REDIRECTS}`] = () =>
      html('<html><h1>Oferta</h1></html>');
    const httpFetch = fetcherOf(hops);

    const result = await pageFetcherOf(httpFetch).fetchPage(
      'https://bolsa.example/jobs/0',
    );

    expect(result).toEqual({
      ok: true,
      html: '<html><h1>Oferta</h1></html>',
      finalUrl: `https://bolsa.example/jobs/${MAX_REDIRECTS}`,
    });
  });

  it('gives up on a redirect loop', async () => {
    const httpFetch = fetcherOf(
      {},
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://bolsa.example/otra' },
        }),
    );

    expect(
      await pageFetcherOf(httpFetch).fetchPage('https://bolsa.example/jobs/1'),
    ).toEqual({ ok: false, reason: 'http_error' });
    expect(httpFetch.attempts).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('no sigue una redirección a una ruta prohibida', async () => {
    // `robots.txt` prohíbe rutas, no dominios: el permiso de la ruta pedida no dice nada del destino, así que se
    // vuelve a preguntar antes de pedirlo y lo prohibido no llega a descargarse (ADR-003).
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () =>
        new Response(null, {
          status: 302,
          headers: { location: '/login?next=/jobs/1' },
        }),
    });
    const asked: string[] = [];

    const result = await pageFetcherOf(httpFetch).fetchPage(
      'https://bolsa.example/jobs/1',
      {
        allowRedirect: (url) => {
          asked.push(url);
          return Promise.resolve(false);
        },
      },
    );

    // El motivo es del sitio, no un error nuestro.
    expect(result).toEqual({ ok: false, reason: 'robots_disallowed' });
    expect(asked).toEqual(['https://bolsa.example/login?next=/jobs/1']);
    expect(httpFetch.attempts.map(({ url }) => url)).toEqual([
      'https://bolsa.example/jobs/1',
    ]);
  });

  it('asks for permission at every hop, and follows the ones allowed', async () => {
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () =>
        new Response(null, { status: 301, headers: { location: '/jobs/1/es' } }),
      'https://bolsa.example/jobs/1/es': () => html('<html><h1>Oferta</h1></html>'),
    });
    const asked: string[] = [];

    const result = await pageFetcherOf(httpFetch).fetchPage(
      'https://bolsa.example/jobs/1',
      {
        allowRedirect: (url) => {
          asked.push(url);
          return Promise.resolve(true);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      finalUrl: 'https://bolsa.example/jobs/1/es',
    });
    expect(asked).toEqual(['https://bolsa.example/jobs/1/es']);
  });

  it('does not follow a redirect to another host', async () => {
    // El permiso del `robots.txt` y el turno de descarga son del host que pedimos. Seguir la redirección sería leer
    // de un sitio al que no hemos preguntado nada, así que se abandona en lugar de obedecerla.
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () =>
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://login.otrositio.example/?next=/jobs/1',
          },
        }),
    });

    expect(
      await pageFetcherOf(httpFetch).fetchPage('https://bolsa.example/jobs/1'),
    ).toEqual({ ok: false, reason: 'http_error' });
    expect(httpFetch.attempts.map(({ url }) => url)).toEqual([
      'https://bolsa.example/jobs/1',
    ]);
  });

  it('does not follow a redirect that leaves http(s)', async () => {
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'android-app://com.bolsa/jobs/1' },
        }),
    });

    expect(
      await pageFetcherOf(httpFetch).fetchPage('https://bolsa.example/jobs/1'),
    ).toEqual({ ok: false, reason: 'http_error' });
  });

  it('gives up on a redirect without a destination', async () => {
    const httpFetch = fetcherOf({
      'https://bolsa.example/jobs/1': () => new Response(null, { status: 301 }),
    });

    expect(
      await pageFetcherOf(httpFetch).fetchPage('https://bolsa.example/jobs/1'),
    ).toEqual({ ok: false, reason: 'http_error' });
  });
});
