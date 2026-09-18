import type {
  PageFetchOptions,
  PageFetchResult,
  PageFetcher,
} from '../../application/ports/page-fetcher.port';

// Implementación de `PAGE_FETCHER` (D6 de link-enrichment, ADR-003): `fetch` con agente identificable, plazo, tope de
// bytes cortando el flujo, tope de redirecciones y solo HTML.
//
// Las redirecciones se siguen **a mano** (`redirect: 'manual'`) por dos motivos que `redirect: 'follow'` no permite:
// contarlas, y comprobar a dónde llevan. Una redirección a otro host no se sigue, porque el permiso del `robots.txt` y
// el turno de descarga se pidieron para el host de la URL original: seguirla sería descargar de un sitio al que no
// hemos preguntado nada, que es exactamente lo que ADR-003 prohíbe.
//
// El tope de bytes se aplica leyendo el cuerpo por trozos y abandonando al superarlo: `response.text()` ya se habría
// traído la respuesta entera en memoria antes de poder medirla.

/** Redirecciones seguidas como máximo (D6). */
export const MAX_REDIRECTS = 3;

/** Códigos de redirección con `Location`. `304` no lo es: no traemos caché. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Tipos de contenido que son una página. Cualquier otro (un PDF, una imagen) no se intenta parsear. */
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/**
 * Lo que la implementación necesita del `fetch` global. Se inyecta para que ningún test toque la red: los dobles
 * devuelven un `Response` construido a mano.
 */
export type HttpFetch = (
  url: string,
  init: {
    readonly method: 'GET';
    readonly redirect: 'manual';
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

export interface HttpPageFetcherOptions {
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/** Juego de caracteres declarado en la respuesta; `utf-8` cuando no dice ninguno o dice uno que no existe. */
function charsetOf(contentType: string | null): string {
  const match = /;\s*charset=\s*"?([^";]+)"?/i.exec(contentType ?? '');
  return match?.[1].trim().toLowerCase() || 'utf-8';
}

function httpUrl(url: string, base?: string): URL | null {
  try {
    const parsed = new URL(url, base);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export class HttpPageFetcher implements PageFetcher {
  constructor(
    private readonly httpFetch: HttpFetch,
    private readonly options: HttpPageFetcherOptions,
  ) {}

  async fetchPage(
    url: string,
    options: PageFetchOptions = {},
  ): Promise<PageFetchResult> {
    const start = httpUrl(url);
    // Solo `http(s)`: un `mailto:` o un `file:` no son una oferta y no se piden.
    if (start === null) return { ok: false, reason: 'http_error' };

    const timeoutMs = Math.max(1, options.timeoutMs ?? this.options.timeoutMs);
    // Un solo plazo para toda la cadena de redirecciones: tres saltos lentos son igual de caros que una página lenta.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.follow(start, controller.signal);
    } catch {
      // El único error que llega hasta aquí es el de la red o el del plazo; `AbortSignal` no distingue cuál con
      // certeza, y para la persona los dos significan lo mismo.
      return {
        ok: false,
        reason: controller.signal.aborted ? 'timeout' : 'http_error',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async follow(
    start: URL,
    signal: AbortSignal,
  ): Promise<PageFetchResult> {
    let current = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await this.httpFetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': this.options.userAgent,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'es,en;q=0.8',
        },
        signal,
      });

      if (REDIRECT_STATUS.has(response.status)) {
        await response.body?.cancel();
        const next = this.nextHop(response, current);
        if (next === null) return { ok: false, reason: 'http_error' };
        current = next;
        continue;
      }

      return await this.read(response, current);
    }
    // Más saltos de los permitidos: un bucle de redirecciones no es una página.
    return { ok: false, reason: 'http_error' };
  }

  /** Destino de la redirección, o `null` si no lo hay, no es `http(s)` o lleva a otro host. */
  private nextHop(response: Response, from: URL): URL | null {
    const location = response.headers.get('location');
    if (location === null) return null;
    const next = httpUrl(location, from.href);
    if (next === null) return null;
    // `www.bolsa.example` y `bolsa.example` son hosts distintos también para su `robots.txt`.
    return next.host === from.host ? next : null;
  }

  private async read(response: Response, from: URL): Promise<PageFetchResult> {
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return { ok: false, reason: 'blocked' };
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return { ok: false, reason: 'rate_limited' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, reason: 'http_error' };
    }

    const contentType = response.headers.get('content-type');
    if (!HTML_MEDIA_TYPES.has(mediaTypeOf(contentType))) {
      await response.body?.cancel();
      return { ok: false, reason: 'not_html' };
    }

    // `Content-Length` es una pista, no una garantía: se comprueba antes para no empezar a leer lo que ya sabemos que
    // no cabe, y se vuelve a comprobar por trozos porque el sitio puede mentir o no declararlo.
    const declared = Number(
      response.headers.get('content-length') ?? Number.NaN,
    );
    if (Number.isFinite(declared) && declared > this.options.maxBytes) {
      await response.body?.cancel();
      return { ok: false, reason: 'too_large' };
    }

    const body = await this.readBody(response);
    if (body === null) return { ok: false, reason: 'too_large' };

    return {
      ok: true,
      html: decode(body, charsetOf(contentType)),
      finalUrl: from.href,
    };
  }

  /** Cuerpo por trozos, abandonando en cuanto supera el tope; `null` cuando no cabe. */
  private async readBody(response: Response): Promise<Uint8Array | null> {
    const stream = response.body;
    if (stream === null) return new Uint8Array();

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.options.maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return all;
  }
}
