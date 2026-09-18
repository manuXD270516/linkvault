import type { RobotsFetcher, RobotsResponse } from './redis-cached-robots';

// Petición real del `robots.txt` (D6 de link-enrichment). Vive aparte de `RedisCachedRobots` porque es lo único de esa
// implementación que toca la red: los tests inyectan un doble y esta función no se ejerce en la suite.

/**
 * Tope del `robots.txt`, el mismo que aplica Google: medio mega de reglas ya es un fichero roto y no hay motivo para
 * leer más. Lo que pase de ahí se descarta, no se interpreta a medias.
 */
export const ROBOTS_MAX_BYTES = 524_288;

export interface HttpRobotsFetcherOptions {
  readonly userAgent: string;
  readonly timeoutMs: number;
}

/**
 * `fetch` con el agente identificable y el plazo de una descarga. No sigue la política de redirecciones de la página:
 * un `robots.txt` que redirige dentro del mismo sitio es normal, y `fetch` la resuelve solo.
 */
export function createHttpRobotsFetcher(
  options: HttpRobotsFetcherOptions,
): RobotsFetcher {
  return async (robotsUrl: string): Promise<RobotsResponse | null> => {
    try {
      const response = await fetch(robotsUrl, {
        redirect: 'follow',
        headers: { 'user-agent': options.userAgent, accept: 'text/plain' },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const body = await response.text();
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: body.length > ROBOTS_MAX_BYTES ? '' : body,
      };
    } catch {
      // Sin respuesta no hay reglas: quien llama lo traduce en "permitido", nunca en un fallo del enriquecimiento.
      return null;
    }
  };
}
