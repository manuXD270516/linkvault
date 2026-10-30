import { findEgressBlocked } from '../../../../infrastructure/egress/egress-blocked-error';
import type { HttpFetch } from '../http/http-page-fetcher';
import type { RobotsFetcher, RobotsResponse } from './redis-cached-robots';

// Petición real del `robots.txt` (D6 de link-enrichment, D5 de enrichment-egress-guard). Vive aparte de
// `RedisCachedRobots` porque es lo único de esa implementación que toca la red: los tests inyectan un doble.

/**
 * Tope del `robots.txt`, el mismo que aplica Google: medio mega de reglas ya es un fichero roto y no hay motivo para
 * leer más. Lo que pase de ahí se descarta, no se interpreta a medias.
 */
export const ROBOTS_MAX_BYTES = 524_288;

/** Redirecciones seguidas como máximo: el mínimo que pide el estándar del `robots.txt` (RFC 9309 §2.3.1.2). */
export const ROBOTS_MAX_REDIRECTS = 5;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Lo que este fetcher necesita de un logger; `Logger` de Nest lo cumple. */
export interface RobotsFetcherLogger {
  warn(entry: Record<string, string>): void;
}

export interface HttpRobotsFetcherOptions {
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly logger?: RobotsFetcherLogger;
}

/** Destino de una redirección, o `null` si no lo hay o no es `http(s)`. */
function nextUrl(response: Response, from: URL): URL | null {
  const location = response.headers.get('location');
  if (location === null) return null;
  try {
    const next = new URL(location, from.href);
    return next.protocol === 'http:' || next.protocol === 'https:'
      ? next
      : null;
  } catch {
    return null;
  }
}

/**
 * Un salto a otro host solo se sigue si el destino es exactamente `/robots.txt` sin query: es el caso que el estándar
 * contempla (el sitio sirve sus reglas desde otro dominio) y no convierte el `robots.txt` en un medio para pedir rutas
 * arbitrarias de otro host.
 */
function mayFollow(from: URL, next: URL): boolean {
  if (next.host === from.host) return true;
  return next.pathname === '/robots.txt' && next.search === '';
}

/** Cuerpo por trozos, abandonando en cuanto supera el tope; cadena vacía cuando no cabe (sin reglas). */
async function readCapped(response: Response): Promise<string> {
  const stream = response.body;
  if (stream === null) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ROBOTS_MAX_BYTES) {
        await reader.cancel();
        return '';
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
  return new TextDecoder('utf-8').decode(all);
}

/**
 * `HttpFetch` guardado con el agente identificable y un único plazo para toda la cadena de redirecciones. Las sigue a
 * mano (hasta cinco, cada salto por el guardia); más saltos, un salto a otro host que no sea `/robots.txt`, un destino
 * que el filtro de salida rechaza o un cuerpo que no cabe significan «no disponible».
 */
export function createHttpRobotsFetcher(
  httpFetch: HttpFetch,
  options: HttpRobotsFetcherOptions,
): RobotsFetcher {
  return async (robotsUrl: string): Promise<RobotsResponse | null> => {
    try {
      const signal = AbortSignal.timeout(options.timeoutMs);
      let current = new URL(robotsUrl);
      for (let followed = 0; ; followed += 1) {
        const response = await httpFetch(current.href, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': options.userAgent, accept: 'text/plain' },
          signal,
        });
        if (!REDIRECT_STATUS.has(response.status)) {
          const body = await readCapped(response);
          return {
            status: response.status,
            contentType: response.headers.get('content-type'),
            body,
          };
        }
        await response.body?.cancel();
        const next = nextUrl(response, current);
        if (
          next === null ||
          followed >= ROBOTS_MAX_REDIRECTS ||
          !mayFollow(current, next)
        ) {
          return null;
        }
        current = next;
      }
    } catch (error) {
      // El `robots.txt` no conoce el link: su registro lleva la etapa y la categoría, sin `linkId`, URL, host ni
      // dirección.
      const blocked = findEgressBlocked(error);
      if (blocked !== null) {
        options.logger?.warn({
          event: 'egress_blocked',
          stage: 'robots',
          category: blocked.category,
        });
      }
      // Sin respuesta no hay reglas: quien llama lo traduce en "permitido", nunca en un fallo del enriquecimiento.
      return null;
    }
  };
}
