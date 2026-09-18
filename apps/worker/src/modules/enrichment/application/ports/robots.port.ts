// Puerto de cortesía con el sitio (D6 de link-enrichment, ADR-003). Solo tipos y el token: quien lo implementa decide
// dónde cachea el `robots.txt` y cómo lo pide. Se inyecta con `{ provide: ROBOTS, useClass: RedisCachedRobots }`.
//
// La decisión es **por URL**, no por host: un `robots.txt` prohíbe rutas, no dominios enteros, y la espera que pide
// depende del grupo que case con nuestro agente.

export const ROBOTS = Symbol('ROBOTS');

export interface RobotsDecision {
  /** `false` solo cuando el `robots.txt` del sitio prohíbe esa ruta a nuestro agente. */
  readonly allowed: boolean;
  /**
   * `Crawl-delay` del grupo aplicable, en milisegundos; `0` cuando el sitio no pide ninguno. La espera efectiva entre
   * dos peticiones al mismo host es el máximo entre este valor y `ENRICH_DOMAIN_DELAY_MS`: el sitio puede pedir más,
   * nunca menos.
   */
  readonly crawlDelayMs: number;
}

export interface Robots {
  /**
   * Qué permite el sitio para esa URL. **Nunca lanza**: un `robots.txt` que no se puede leer, que responde un error o
   * que no es texto no se interpreta como reglas y se asume permitido (D6). Prohibir por no haber podido leer un
   * fichero opcional convertiría cualquier caída ajena en un `robots_disallowed` que la persona leería como "esta
   * bolsa no nos deja", que es mentira.
   */
  decide(url: string): Promise<RobotsDecision>;
}
