import type { EnrichmentFailureReason, PreviewDraft } from '@linkvault/shared';
import type { ExtractionChain } from '../domain/extraction-chain';
import {
  baseSalaryTextOf,
  findJobPosting,
} from '../domain/extractors/json-ld.extractor';
import { historyRescueUrls } from '../domain/history-rescue';
import {
  effectiveWaitMs,
  onBusyHost,
  type HostTurnRules,
} from '../domain/host-turn';
import type { HostMutex } from './ports/host-mutex.port';
import type { PageFetcher } from './ports/page-fetcher.port';
import type { PageParser } from './ports/page-parser.port';
import type { Robots } from './ports/robots.port';

// Todo lo que hay entre "hay un link que leer" y "esto es lo que la página decía" (D3 y D6 de link-enrichment):
// permiso del sitio, turno del host, descarga, parseo y cadena de extracción. El caso de uso de arriba se queda con lo
// suyo —idempotencia, merge, estado y escritura— y este servicio con la parte que habla con el sitio.
//
// La descarga va **por `displayUrl`**, la primera URL que escribió una persona, nunca por la normalizada: la
// normalizada existe solo para la identidad del link (ADR-008) y puede haber perdido parámetros que el sitio necesita
// para servir la oferta. La única excepción es el rescate por historial (D7 de paste-job-description): si el
// `robots.txt` niega la `displayUrl`, se lee la primera URL permitida del historial del mismo host, dentro del mismo
// turno. La `displayUrl` no cambia: sigue siendo la que se abre.

export interface LinkToExtract {
  readonly displayUrl: string;
  /** Las URLs con las que se ha guardado la vacante, de la más antigua a la más reciente (D7 de paste-job-description). */
  readonly originalUrls: readonly string[];
  /** Quién guardó el link: la etapa de IA se atribuye a esa persona (D7). */
  readonly createdBy: string;
}

/** Lo que la pasada leyó de la página. `html` es lo que se guarda como snapshot si la escritura gana la carrera. */
export interface ExtractionSucceeded {
  readonly kind: 'extracted';
  readonly draft: PreviewDraft;
  readonly ran: readonly string[];
  readonly isJobPosting?: boolean;
  readonly html: string;
  /**
   * Blob salarial textual de JSON-LD (`baseSalary` string) cuando el sitio no trae montos
   * estructurados — prioridad del parse ADR-046 frente a `summary`.
   */
  readonly salaryTextCandidate?: string | null;
}

/** El host estaba ocupado: el job vuelve a la cola con espera, sin tocar el link. */
export interface ExtractionDeferred {
  readonly kind: 'deferred';
  readonly deferrals: number;
  readonly waitMs: number;
}

/** No se pudo leer la página, y el motivo es de la lista cerrada de D5. */
export interface ExtractionFailed {
  readonly kind: 'failed';
  readonly reason: EnrichmentFailureReason;
}

export type ExtractionAttempt =
  ExtractionSucceeded | ExtractionDeferred | ExtractionFailed;

export interface ExtractPreviewInput {
  readonly link: LinkToExtract;
  /** Aplazamientos que este job ya lleva por encontrar su host ocupado. */
  readonly deferrals: number;
  /** Instante (epoch ms) en que vence el plazo por link. */
  readonly deadlineAt: number;
  readonly signal?: AbortSignal;
}

export interface ExtractPreviewOptions extends HostTurnRules {
  /** `ENRICH_FETCH_TIMEOUT_MS`: tope de una descarga, recortado por lo que quede del plazo del link. */
  readonly fetchTimeoutMs: number;
}

/** Un sitio que no ha pedido ninguna espera, o al que todavía no se le ha podido preguntar. */
const NO_CRAWL_DELAY = 0;

/** Host de una URL, para pedir su turno. Sale del link leído en Mongo: el evento nunca trae la URL del usuario. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export class ExtractPreviewService {
  constructor(
    private readonly robots: Robots,
    private readonly hostMutex: HostMutex,
    private readonly pageFetcher: PageFetcher,
    private readonly parsePage: PageParser,
    private readonly chain: ExtractionChain,
    private readonly now: () => number,
    private readonly options: ExtractPreviewOptions,
  ) {}

  async run(input: ExtractPreviewInput): Promise<ExtractionAttempt> {
    const displayUrl = input.link.displayUrl;
    const host = hostOf(displayUrl);
    // Una URL que no tiene host no se puede pedir a nadie; el link se guardó con algo que no es una dirección.
    if (host === null) return { kind: 'failed', reason: 'http_error' };

    // El turno del host va **primero**, y el permiso dentro. Preguntar al `robots.txt` cuesta una petición al sitio la
    // primera vez, y su caché es por host: preguntando antes del turno, siete links del mismo host encolados a la vez
    // fallan la caché a la vez y llaman tres veces a la puerta de un sitio al que habíamos prometido ir de uno en uno
    // (ADR-003). Dentro del turno solo pregunta quien va a descargar, y el resto se lo encuentra ya cacheado.
    const lease = await this.hostMutex.acquire(host);
    if (lease === null) {
      // Sin turno no hay permiso a mano, así que el aplazamiento usa nuestra cortesía y no el `Crawl-delay` del sitio.
      // No es un atajo: el aplazamiento solo dice cuándo volver a intentarlo, y la espera de verdad entre dos
      // peticiones la guarda el mutex, que no concede el turno hasta que vence. Volver antes de tiempo cuesta otro
      // aplazamiento, que no cuesta nada, y no una petición al sitio.
      const decision = onBusyHost(
        this.options,
        input.deferrals,
        NO_CRAWL_DELAY,
      );
      return decision.kind === 'defer'
        ? {
            kind: 'deferred',
            deferrals: decision.deferrals,
            waitMs: decision.waitMs,
          }
        : { kind: 'failed', reason: decision.reason };
    }

    let html: string;
    // Lo que el sitio pide esperar, para soltar el turno con ello aunque no se llegue a preguntar.
    let crawlDelayMs = NO_CRAWL_DELAY;
    try {
      const remainingMs = input.deadlineAt - this.now();
      if (remainingMs <= 0) return { kind: 'failed', reason: 'timeout' };

      // El permiso de esta URL no vale para el destino de una redirección, así que la descarga vuelve a preguntar en
      // cada salto.
      const permission = await this.robots.decide(displayUrl);
      crawlDelayMs = permission.crawlDelayMs;
      let url: string | null = permission.allowed ? displayUrl : null;

      // Rescate por historial: las demás URLs de la vacante del mismo host, una a una y dentro de este mismo turno,
      // hasta la primera permitida. Ninguna prohibida llega a pedirse.
      if (url === null) {
        for (const candidate of historyRescueUrls(
          displayUrl,
          input.link.originalUrls,
        )) {
          const decision = await this.robots.decide(candidate);
          crawlDelayMs = Math.max(crawlDelayMs, decision.crawlDelayMs);
          if (decision.allowed) {
            url = candidate;
            break;
          }
        }
      }
      if (url === null) {
        return { kind: 'failed', reason: 'robots_disallowed' };
      }

      const fetched = await this.pageFetcher.fetchPage(url, {
        timeoutMs: Math.min(this.options.fetchTimeoutMs, remainingMs),
        // El permiso de arriba es el de esta URL. Una redirección lleva a otra ruta, y el `robots.txt` prohíbe rutas:
        // cada salto vuelve a preguntar antes de pedir nada, o una ruta permitida que redirige a una prohibida sería
        // la puerta de atrás de ADR-003. La respuesta sale de la caché por host, así que no cuesta otra petición.
        allowRedirect: async (next: string) =>
          (await this.robots.decide(next)).allowed,
      });
      if (!fetched.ok) return { kind: 'failed', reason: fetched.reason };
      html = fetched.html;
    } finally {
      // El turno se suelta pase lo que pase —también cuando el `robots.txt` niega la ruta—, y se convierte en la
      // espera que pide el sitio: hasta un fallo deja al host descansando lo suyo, porque insistir en el sitio que
      // acaba de fallar es lo contrario de la cortesía.
      await lease.release(effectiveWaitMs(this.options, crawlDelayMs));
    }

    const page = this.parsePage(html);
    const extracted = await this.chain.run({
      page,
      createdBy: input.link.createdBy,
      deadlineAt: input.deadlineAt,
      signal: input.signal,
    });

    const posting = findJobPosting(page.jsonLdBlocks);
    const salaryTextCandidate =
      posting !== null ? baseSalaryTextOf(posting) : null;

    return {
      kind: 'extracted',
      draft: extracted.draft,
      ran: extracted.ran,
      isJobPosting: extracted.isJobPosting,
      html,
      salaryTextCandidate,
    };
  }
}
