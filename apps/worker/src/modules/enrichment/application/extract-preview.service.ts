import type { EnrichmentFailureReason } from '@linkvault/shared';
import type { ExtractionChain } from '../domain/extraction-chain';
import {
  effectiveWaitMs,
  onBusyHost,
  type HostTurnRules,
} from '../domain/host-turn';
import type { PreviewDraft } from '../domain/preview-draft';
import type { HostMutex } from './ports/host-mutex.port';
import type { PageFetcher } from './ports/page-fetcher.port';
import type { PageParser } from './ports/page-parser.port';
import type { Robots } from './ports/robots.port';

// Todo lo que hay entre "hay un link que leer" y "esto es lo que la página decía" (D3 y D6 de link-enrichment):
// permiso del sitio, turno del host, descarga, parseo y cadena de extracción. El caso de uso de arriba se queda con lo
// suyo —idempotencia, merge, estado y escritura— y este servicio con la parte que habla con el sitio.
//
// La descarga va **siempre por `displayUrl`**, la primera URL que escribió una persona, nunca por la normalizada: la
// normalizada existe solo para la identidad del link (ADR-008) y puede haber perdido parámetros que el sitio necesita
// para servir la oferta.

export interface LinkToExtract {
  readonly displayUrl: string;
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
    const url = input.link.displayUrl;
    const host = hostOf(url);
    // Una URL que no tiene host no se puede pedir a nadie; el link se guardó con algo que no es una dirección.
    if (host === null) return { kind: 'failed', reason: 'http_error' };

    // Primero el permiso: preguntar al `robots.txt` no cuesta una petición al sitio salvo la primera vez del día.
    const permission = await this.robots.decide(url);
    if (!permission.allowed) {
      return { kind: 'failed', reason: 'robots_disallowed' };
    }

    const lease = await this.hostMutex.acquire(host);
    if (lease === null) {
      const decision = onBusyHost(
        this.options,
        input.deferrals,
        permission.crawlDelayMs,
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
    try {
      const remainingMs = input.deadlineAt - this.now();
      if (remainingMs <= 0) return { kind: 'failed', reason: 'timeout' };

      const fetched = await this.pageFetcher.fetchPage(url, {
        timeoutMs: Math.min(this.options.fetchTimeoutMs, remainingMs),
      });
      if (!fetched.ok) return { kind: 'failed', reason: fetched.reason };
      html = fetched.html;
    } finally {
      // El turno se suelta pase lo que pase, y se convierte en la espera que pide el sitio: hasta un fallo deja al
      // host descansando lo suyo, porque insistir en el sitio que acaba de fallar es lo contrario de la cortesía.
      await lease.release(
        effectiveWaitMs(this.options, permission.crawlDelayMs),
      );
    }

    const page = this.parsePage(html);
    const extracted = await this.chain.run({
      page,
      createdBy: input.link.createdBy,
      deadlineAt: input.deadlineAt,
      signal: input.signal,
    });

    return {
      kind: 'extracted',
      draft: extracted.draft,
      ran: extracted.ran,
      isJobPosting: extracted.isJobPosting,
      html,
    };
  }
}
