import robotsParser from 'robots-parser';
import type {
  Robots,
  RobotsDecision,
} from '../../application/ports/robots.port';

// Implementación de `ROBOTS` (D6 de link-enrichment, ADR-003): pide el `robots.txt` una vez por host y lo guarda en
// Redis durante `ENRICH_ROBOTS_TTL_SECONDS`, incluido el que prohíbe. Releerlo en cada link sería una petición extra
// por descarga al mismo sitio al que estamos pidiendo cortesía.
//
// Lo que se cachea es el **cuerpo**, no la decisión: un `robots.txt` prohíbe rutas, así que dos links del mismo host
// pueden tener respuestas distintas con el mismo fichero. La cadena vacía significa "sin reglas que aplicar", que es
// también lo que se guarda cuando el fichero no se pudo leer o no era texto.
//
// El grupo aplicable lo resuelve `robots-parser`: normaliza el agente (minúsculas, sin la versión tras la barra), busca
// su grupo y recae en `*` cuando no hay uno propio. Nuestro `LinkVaultBot/0.1 (+…)` casa así con `User-agent:
// LinkVaultBot`.

/** Prefijo de la clave por host. El TTL lo pone `ENRICH_ROBOTS_TTL_SECONDS`. */
export const ROBOTS_CACHE_KEY_PREFIX = 'enrich:robots:';

export function robotsCacheKey(host: string): string {
  return `${ROBOTS_CACHE_KEY_PREFIX}${host}`;
}

/** Respuesta cruda del `robots.txt`, con lo justo para decidir si se puede interpretar. */
export interface RobotsResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

/**
 * Petición del `robots.txt`. Devuelve `null` cuando no se llegó a tener respuesta (red caída, plazo agotado, host que
 * no resuelve): es un puerto de la implementación para que ningún test toque la red.
 */
export type RobotsFetcher = (
  robotsUrl: string,
) => Promise<RobotsResponse | null>;

/**
 * Lo que el adaptador necesita de Redis, declarado aquí en vez de con `Pick<Redis, …>`: un `Redis` de ioredis lo
 * cumple, y un doble de test también, sin arrastrar las cientos de sobrecargas variádicas del cliente real.
 */
export interface RobotsCacheClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    seconds: number,
  ): Promise<'OK' | null>;
}

export interface RedisCachedRobotsOptions {
  /** El mismo `ENRICH_USER_AGENT` con el que se descarga la página: el grupo se resuelve contra él. */
  readonly userAgent: string;
  readonly ttlSeconds: number;
}

/** Sin reglas aplicables: permitido y sin espera propia del sitio. */
const NO_RULES: RobotsDecision = { allowed: true, crawlDelayMs: 0 };

/** Un `robots.txt` servido como HTML (o como cualquier cosa que no sea texto) no son reglas. */
function isPlainText(contentType: string | null): boolean {
  if (contentType === null) return true;
  const essence = contentType.split(';')[0].trim().toLowerCase();
  return essence.startsWith('text/') && essence !== 'text/html';
}

/** Página de bloqueo servida con la cabecera equivocada: el cuerpo manda sobre el `Content-Type`. */
function looksLikeHtml(body: string): boolean {
  return /^\s*(?:<!doctype html|<html|<head|<body)/i.test(body);
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export class RedisCachedRobots implements Robots {
  constructor(
    private readonly client: RobotsCacheClient,
    private readonly fetchRobots: RobotsFetcher,
    private readonly options: RedisCachedRobotsOptions,
  ) {}

  async decide(url: string): Promise<RobotsDecision> {
    const target = parseUrl(url);
    // Una URL que ni siquiera se puede interpretar no la juzga el `robots.txt`: la rechazará la descarga.
    if (target === null) return NO_RULES;

    const cached = await this.readCache(target.host);
    const body = cached ?? (await this.loadAndCache(target));
    return this.evaluate(target, body);
  }

  /** Un fallo de Redis no prohíbe nada: se vuelve a pedir el fichero. */
  private async readCache(host: string): Promise<string | null> {
    try {
      return await this.client.get(robotsCacheKey(host));
    } catch {
      return null;
    }
  }

  private async loadAndCache(target: URL): Promise<string> {
    const body = await this.load(target);
    try {
      await this.client.set(
        robotsCacheKey(target.host),
        body,
        'EX',
        this.options.ttlSeconds,
      );
    } catch {
      // Sin caché el sitio recibe una petición de más, que es preferible a fallar el enriquecimiento.
    }
    return body;
  }

  /** Cuerpo interpretable del `robots.txt`, o la cadena vacía cuando no lo hay. Nunca lanza. */
  private async load(target: URL): Promise<string> {
    let response: RobotsResponse | null;
    try {
      response = await this.fetchRobots(`${target.origin}/robots.txt`);
    } catch {
      response = null;
    }
    if (response === null) return '';
    // Fuera del 2xx no hay fichero que interpretar: ni el `404` de quien no lo publica, ni el `500` de quien lo tiene
    // roto, ni el `403` con el que una bolsa nos recibe. Ninguno de los tres es una prohibición.
    if (response.status < 200 || response.status >= 300) return '';
    if (!isPlainText(response.contentType) || looksLikeHtml(response.body)) {
      return '';
    }
    return response.body;
  }

  private evaluate(target: URL, body: string): RobotsDecision {
    if (body.trim() === '') return NO_RULES;
    const rules = robotsParser(`${target.origin}/robots.txt`, body);
    // `isAllowed` devuelve `undefined` si la URL no pertenece a ese `robots.txt`; aquí no puede pasar, porque el
    // fichero se pide contra el mismo origen, pero el contrato del puerto dice "permitido" ante la duda.
    const allowed =
      rules.isAllowed(target.href, this.options.userAgent) ?? true;
    const crawlDelaySeconds = rules.getCrawlDelay(this.options.userAgent);
    return {
      allowed,
      crawlDelayMs:
        typeof crawlDelaySeconds === 'number' && crawlDelaySeconds > 0
          ? Math.round(crawlDelaySeconds * 1000)
          : 0,
    };
  }
}
