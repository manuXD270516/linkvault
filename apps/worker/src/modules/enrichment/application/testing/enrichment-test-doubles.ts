import type {
  ExtractionContext,
  ExtractionOutcome,
  ExtractorStrategy,
} from '../../domain/extractors/extractor';
import {
  draftFrom,
  type JobPreview,
  type LinkEnrichedEvent,
} from '@linkvault/shared';
import type { Clock } from '../ports/clock.port';
import type { EnrichmentNotifier } from '../ports/enrichment-notifier.port';
import type { HostLease, HostMutex } from '../ports/host-mutex.port';
import type {
  EnrichableLink,
  LinkRepository,
  PreviewWrite,
} from '../ports/link-repository.port';
import type {
  PageFetchOptions,
  PageFetchResult,
  PageFetcher,
} from '../ports/page-fetcher.port';
import type { Robots, RobotsDecision } from '../ports/robots.port';
import type { SnapshotStore } from '../ports/snapshot-store.port';

// Dobles de los puertos del enriquecimiento. Ningún test toca la red ni Redis: `PAGE_FETCHER`, `ROBOTS` y
// `HOST_MUTEX` se sustituyen aquí, y cada doble recuerda lo que se le pidió para poder afirmarlo.

/** `robots.txt` que permite todo y no pide espera, que es el caso de las dos bolsas legibles del manifiesto. */
export class FakeRobots implements Robots {
  readonly asked: string[] = [];
  /** Rutas concretas que este `robots.txt` prohíbe, para los sitios que solo niegan una parte. */
  readonly forbidden = new Set<string>();

  constructor(
    private readonly decision: RobotsDecision = {
      allowed: true,
      crawlDelayMs: 0,
    },
  ) {}

  decide(url: string): Promise<RobotsDecision> {
    this.asked.push(url);
    return Promise.resolve(
      this.forbidden.has(url)
        ? { ...this.decision, allowed: false }
        : this.decision,
    );
  }
}

/**
 * Turno por host, anotando la espera con la que se soltó cada uno. Como el mutex de Redis, **es exclusivo mientras el
 * turno está tomado**: quien lo pide con otro dentro se lleva `null` y se aplaza. Un doble que concediera el turno a
 * todos no podría distinguir entre pedir permiso dentro del turno y pedirlo fuera, que es de lo que vive la cortesía.
 */
export class FakeHostMutex implements HostMutex {
  readonly acquired: string[] = [];
  readonly released: { host: string; waitMs: number }[] = [];
  /** Hosts que están ocupados desde antes: pedir su turno devuelve `null`. */
  readonly busy = new Set<string>();
  private readonly taken = new Set<string>();

  acquire(host: string): Promise<HostLease | null> {
    this.acquired.push(host);
    if (this.busy.has(host) || this.taken.has(host))
      return Promise.resolve(null);
    this.taken.add(host);
    return Promise.resolve({
      release: (waitMs: number) => {
        this.taken.delete(host);
        this.released.push({ host, waitMs });
        return Promise.resolve();
      },
    });
  }
}

/** El host de una URL para la caché del `robots.txt`; la URL entera si no se puede interpretar. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * `robots.txt` con caché por host, como `RedisCachedRobots`: la primera consulta de un host le pide el fichero al sitio
 * y las siguientes salen de la caché. La caché se llena **cuando vuelve la petición**, no al empezarla, así que dos
 * consultas a la vez del mismo host la fallan las dos y pisan dos veces el sitio, exactamente como en producción: es lo
 * que deja ver si el permiso se pregunta dentro del turno del host o fuera.
 */
export class FakeCachingRobots implements Robots {
  readonly asked: string[] = [];
  /** Un apunte por petición al `robots.txt` del sitio; lo que la caché ahorra no aparece aquí. */
  readonly fetched: string[] = [];
  /** Rutas concretas que este `robots.txt` prohíbe, para los sitios que solo niegan una parte. */
  readonly forbidden = new Set<string>();
  private readonly cached = new Set<string>();

  constructor(
    private readonly decision: RobotsDecision = {
      allowed: true,
      crawlDelayMs: 0,
    },
  ) {}

  async decide(url: string): Promise<RobotsDecision> {
    this.asked.push(url);
    const host = hostOf(url);
    if (!this.cached.has(host)) {
      this.fetched.push(host);
      // Pedirle el fichero al sitio tarda: hasta que no vuelve, la caché sigue vacía para todos los demás.
      await new Promise((resolve) => setImmediate(resolve));
      this.cached.add(host);
    }
    return this.forbidden.has(url)
      ? { ...this.decision, allowed: false }
      : this.decision;
  }
}

/** Descarga que devuelve lo que se le diga, anotando a qué URL fue y con qué plazo. */
export class FakePageFetcher implements PageFetcher {
  readonly requested: { url: string; timeoutMs?: number }[] = [];
  /** Destino al que esta descarga redirige, cuando el test quiere una redirección. */
  redirectsTo: string | null = null;

  constructor(private result: PageFetchResult) {}

  answerWith(result: PageFetchResult): void {
    this.result = result;
  }

  async fetchPage(
    url: string,
    options: PageFetchOptions = {},
  ): Promise<PageFetchResult> {
    this.requested.push({ url, timeoutMs: options.timeoutMs });
    if (this.redirectsTo === null) return this.result;

    // Lo mismo que hace `HttpPageFetcher`: pedir permiso para el destino **antes** de pedir el destino.
    const allowed = (await options.allowRedirect?.(this.redirectsTo)) ?? true;
    if (!allowed) return { ok: false, reason: 'robots_disallowed' };
    this.requested.push({
      url: this.redirectsTo,
      timeoutMs: options.timeoutMs,
    });
    return this.result;
  }
}

/** Descarga que entrega un HTML concreto. */
export function htmlResponse(
  html: string,
  finalUrl = 'https://bolsa.example/jobs/1',
): PageFetchResult {
  return { ok: true, html, finalUrl };
}

/** Etapa de mentira: propone lo que se le diga y recuerda con qué contexto se la ejecutó. */
export class StubExtractor implements ExtractorStrategy {
  readonly contexts: ExtractionContext[] = [];

  constructor(
    readonly id: string,
    private readonly outcome: {
      fields?: Partial<JobPreview>;
      isJobPosting?: boolean;
      supports?: boolean;
      fails?: boolean;
    } = {},
  ) {}

  supports(): boolean {
    return this.outcome.supports ?? true;
  }

  extract(context: ExtractionContext): Promise<ExtractionOutcome> {
    this.contexts.push(context);
    if (this.outcome.fails === true) {
      return Promise.reject(new Error(`${this.id} se rompió`));
    }
    return Promise.resolve({
      draft: draftFrom(this.id, this.outcome.fields ?? {}),
      ...(this.outcome.isJobPosting === undefined
        ? {}
        : { isJobPosting: this.outcome.isJobPosting }),
    });
  }

  get ran(): boolean {
    return this.contexts.length > 0;
  }
}

/** Reloj que no avanza solo: el test decide qué hora es. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Link guardado, con lo que el enriquecimiento lee y escribe. */
export interface StoredLink extends EnrichableLink {
  readonly snapshotKey?: string;
}

/**
 * Repositorio en memoria con la misma condición de versión que el de Mongo: es lo que permite probar la carrera de D2
 * sin base de datos, escribiendo desde el test lo que haría la otra ejecución.
 */
export class InMemoryLinkRepository implements LinkRepository {
  readonly writes: {
    linkId: string;
    expectedVersion: number;
    write: PreviewWrite;
  }[] = [];
  private readonly links = new Map<string, StoredLink>();

  put(link: StoredLink): void {
    this.links.set(link.id, link);
  }

  peek(linkId: string): StoredLink | undefined {
    return this.links.get(linkId);
  }

  findById(linkId: string): Promise<EnrichableLink | null> {
    return Promise.resolve(this.links.get(linkId) ?? null);
  }

  writePreview(
    linkId: string,
    expectedVersion: number,
    write: PreviewWrite,
  ): Promise<boolean> {
    this.writes.push({ linkId, expectedVersion, write });
    const link = this.links.get(linkId);
    if (link === undefined || link.previewVersion !== expectedVersion) {
      return Promise.resolve(false);
    }
    this.links.set(linkId, {
      ...link,
      previewStatus: write.previewStatus,
      previewVersion: expectedVersion + 1,
      preview: write.preview,
      previewSources: write.previewSources,
    });
    return Promise.resolve(true);
  }

  saveSnapshotKey(linkId: string, snapshotKey: string): Promise<void> {
    const link = this.links.get(linkId);
    if (link !== undefined) this.links.set(linkId, { ...link, snapshotKey });
    return Promise.resolve();
  }
}

/** Almacén de snapshots en memoria; puede fingir estar caído. */
export class InMemorySnapshotStore implements SnapshotStore {
  readonly objects = new Map<string, string>();

  constructor(private readonly down = false) {}

  save(
    linkId: string,
    previewVersion: number,
    html: string,
  ): Promise<string | null> {
    if (this.down) return Promise.resolve(null);
    const key = `${linkId}/${previewVersion}.html.gz`;
    this.objects.set(key, html);
    return Promise.resolve(key);
  }
}

/** Publicador que se queda los avisos para poder afirmarlos. */
export class InMemoryEnrichmentNotifier implements EnrichmentNotifier {
  readonly published: LinkEnrichedEvent[] = [];

  publish(event: LinkEnrichedEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}
