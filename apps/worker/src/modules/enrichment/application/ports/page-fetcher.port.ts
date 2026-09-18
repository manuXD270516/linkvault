import type { EnrichmentFailureReason } from '@linkvault/shared';

// Puerto de descarga de la página (D6 de link-enrichment, ADR-003). Solo tipos y el token: se inyecta con
// `{ provide: PAGE_FETCHER, useClass: HttpPageFetcher }`.
//
// El puerto **no lanza**: una descarga que no sale bien devuelve su motivo, ya tomado de la lista cerrada de D5, para
// que el caso de uso lo escriba en el link sin tener que traducir excepciones de la red. Lo que nunca sale de aquí es
// el cuerpo de la respuesta ni la URL del usuario: eso no se registra en ningún sitio.

export const PAGE_FETCHER = Symbol('PAGE_FETCHER');

/**
 * Motivos que puede producir una descarga, un subconjunto de los de D5. `blocked` es el sitio negándonos la petición
 * (`401`/`403`) y `rate_limited` el sitio pidiendo que volvamos más tarde (`429`): los dos son suyos, no nuestros, y
 * por eso se cuentan aparte de `http_error`. `robots_disallowed` es el destino de una redirección que el `robots.txt`
 * prohíbe: tampoco es un error nuestro, es el sitio diciendo que ahí no se entra.
 */
export type PageFetchFailureReason = Extract<
  EnrichmentFailureReason,
  | 'robots_disallowed'
  | 'blocked'
  | 'rate_limited'
  | 'not_html'
  | 'too_large'
  | 'timeout'
  | 'http_error'
>;

export interface PageFetchSuccess {
  readonly ok: true;
  /** HTML ya decodificado con el juego de caracteres que declaró la respuesta. */
  readonly html: string;
  /** URL que respondió de verdad, tras las redirecciones seguidas. Puede no ser la pedida. */
  readonly finalUrl: string;
}

export interface PageFetchFailure {
  readonly ok: false;
  readonly reason: PageFetchFailureReason;
}

export type PageFetchResult = PageFetchSuccess | PageFetchFailure;

export interface PageFetchOptions {
  /**
   * Plazo de esta descarga. Sin él se usa `ENRICH_FETCH_TIMEOUT_MS`; el caso de uso lo recorta cuando al link le queda
   * menos plazo total que eso.
   */
  readonly timeoutMs?: number;
  /**
   * Permiso para **cada destino de una redirección**, antes de pedirlo. El permiso que el caso de uso consultó es el
   * de la URL que escribió la persona, y una redirección lleva a otra ruta: sin volver a preguntar, un `302` desde una
   * ruta permitida hacia una con `Disallow` descargaría lo que el sitio prohíbe (ADR-003). Quien no lo pase sigue las
   * redirecciones sin preguntar, que es lo que quiere quien ya sabe que no las habrá.
   */
  readonly allowRedirect?: (url: string) => Promise<boolean>;
}

export interface PageFetcher {
  fetchPage(url: string, options?: PageFetchOptions): Promise<PageFetchResult>;
}
