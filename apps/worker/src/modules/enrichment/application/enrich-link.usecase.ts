import { linkEnrichedEvent, type PreviewStatus } from '@linkvault/shared';
import { mergeIntoStored } from '../domain/merge';
import { verdictOf } from '../domain/preview-status';
import type {
  ExtractPreviewService,
  ExtractionFailed,
  ExtractionSucceeded,
} from './extract-preview.service';
import type { Clock } from './ports/clock.port';
import type { EnrichmentNotifier } from './ports/enrichment-notifier.port';
import type { LinkRepository } from './ports/link-repository.port';
import type { SnapshotStore } from './ports/snapshot-store.port';

// Caso de uso del consumidor de `enrich-link` (D2, D5, D9 y D12 de link-enrichment).
//
// **La idempotencia es propia, no prestada del `jobId`.** El `jobId` determinista solo evita duplicados mientras la
// cola recuerda el trabajo; pasada su retención, el mismo evento puede volver a entrar. Lo que garantiza que el
// resultado sea el mismo son los tres pasos de D2: descartar por versión antes de trabajar, escribir condicionado a la
// versión leída, y terminar sin reintento cuando la escritura no modifica nada.
//
// El orden del final también es de D2 y D12: primero la escritura condicionada, y **solo si gana** el snapshot y el
// aviso. La ejecución perdedora no sube ningún objeto ni avisa de un preview que no escribió.

export interface EnrichLinkJob {
  readonly linkId: string;
  readonly previewVersion: number;
  /** Aplazamientos que este job ya lleva por encontrar su host ocupado. */
  readonly deferrals: number;
}

/** El link quedó escrito. */
export interface EnrichLinkDone {
  readonly kind: 'done';
  readonly previewStatus: PreviewStatus;
  readonly previewVersion: number;
}

/** No había nada que hacer. Ninguno de los tres es un error: el job se completa sin reintento. */
export interface EnrichLinkSkipped {
  readonly kind: 'skipped';
  readonly reason: 'link_not_found' | 'stale_version' | 'lost_race';
}

/** El host estaba ocupado: el job vuelve a la cola con espera. */
export interface EnrichLinkDeferred {
  readonly kind: 'deferred';
  readonly deferrals: number;
  readonly waitMs: number;
}

export type EnrichLinkResult =
  EnrichLinkDone | EnrichLinkSkipped | EnrichLinkDeferred;

export class EnrichLinkUseCase {
  constructor(
    private readonly links: LinkRepository,
    private readonly extractPreview: ExtractPreviewService,
    private readonly snapshots: SnapshotStore,
    private readonly notifier: EnrichmentNotifier,
    private readonly clock: Clock,
    /** `ENRICH_DEADLINE_MS`: plazo total por link, repartido entre las etapas de la cadena. */
    private readonly deadlineMs: number,
  ) {}

  async execute(job: EnrichLinkJob): Promise<EnrichLinkResult> {
    const link = await this.links.findById(job.linkId);
    // Un link que ya no existe completa el job sin error: alguien lo borró entre el alta y su turno.
    if (link === null) return { kind: 'skipped', reason: 'link_not_found' };

    // Este trabajo ya quedó viejo: hay una versión posterior, sea de otro enriquecimiento o de una edición a mano.
    if (link.previewVersion > job.previewVersion) {
      return { kind: 'skipped', reason: 'stale_version' };
    }

    const startedAt = this.clock.now();
    const attempt = await this.extractPreview.run({
      link: {
        displayUrl: link.displayUrl,
        originalUrls: link.originalUrls,
        createdBy: link.createdBy,
      },
      deferrals: job.deferrals,
      deadlineAt: startedAt.getTime() + this.deadlineMs,
    });

    // El host estaba ocupado: no se toca el link, el job vuelve a la cola.
    if (attempt.kind === 'deferred') {
      return {
        kind: 'deferred',
        deferrals: attempt.deferrals,
        waitMs: attempt.waitMs,
      };
    }

    const at = this.clock.now();
    const stored = { preview: link.preview, sources: link.previewSources };
    // Una descarga que falló no borra lo que ya había: el preview se conserva y lo que cambia es el estado.
    const state =
      attempt.kind === 'extracted'
        ? mergeIntoStored(stored, attempt.draft, at.toISOString())
        : stored;

    const verdict = verdictOf({
      state,
      ...(attempt.kind === 'failed' ? { failure: attempt.reason } : {}),
      ...(attempt.kind === 'extracted' && attempt.isJobPosting !== undefined
        ? { isJobPosting: attempt.isJobPosting }
        : {}),
    });

    const won = await this.links.writePreview(link.id, link.previewVersion, {
      previewStatus: verdict.status,
      preview: state.preview,
      previewSources: state.sources,
      lastEnrichmentError:
        verdict.reason === null
          ? null
          : { reason: verdict.reason, at: at.toISOString() },
      at,
    });
    // Otro ganó la carrera: ni snapshot, ni aviso, ni reintento. Lo que escribió el otro es lo bueno.
    if (!won) return { kind: 'skipped', reason: 'lost_race' };

    const previewVersion = link.previewVersion + 1;
    await this.storeSnapshot(link.id, previewVersion, attempt);
    await this.announce(link.id, verdict.status, previewVersion);

    return { kind: 'done', previewStatus: verdict.status, previewVersion };
  }

  /**
   * Un job que agotó sus reintentos: el link deja de estar `pending` y dice por qué (D5). Pasa por la misma escritura
   * condicionada que todo lo demás, así que no pisa a un enriquecimiento posterior que sí salió bien ni a una edición
   * a mano, y el preview que hubiera se conserva: lo único que cambia es el estado y el motivo.
   */
  async markRetriesExhausted(job: EnrichLinkJob): Promise<EnrichLinkResult> {
    const link = await this.links.findById(job.linkId);
    if (link === null) return { kind: 'skipped', reason: 'link_not_found' };
    if (link.previewVersion > job.previewVersion) {
      return { kind: 'skipped', reason: 'stale_version' };
    }

    const at = this.clock.now();
    const state = { preview: link.preview, sources: link.previewSources };
    const verdict = verdictOf({ state, failure: 'retries_exhausted' });

    const won = await this.links.writePreview(link.id, link.previewVersion, {
      previewStatus: verdict.status,
      preview: state.preview,
      previewSources: state.sources,
      lastEnrichmentError: {
        reason: 'retries_exhausted',
        at: at.toISOString(),
      },
      at,
    });
    if (!won) return { kind: 'skipped', reason: 'lost_race' };

    const previewVersion = link.previewVersion + 1;
    await this.announce(link.id, verdict.status, previewVersion);
    return { kind: 'done', previewStatus: verdict.status, previewVersion };
  }

  /**
   * El snapshot se sube **después** de ganar la escritura, y su clave se guarda en el link: nunca se deduce de
   * `previewVersion`, que también sube con las ediciones manuales y con los reintentos, que no producen ninguno.
   */
  private async storeSnapshot(
    linkId: string,
    previewVersion: number,
    attempt: ExtractionSucceeded | ExtractionFailed,
  ): Promise<void> {
    // Sin HTML no hay copia que guardar: lo que no se pudo descargar no deja snapshot.
    if (attempt.kind !== 'extracted') return;
    const key = await this.snapshots.save(linkId, previewVersion, attempt.html);
    if (key !== null) await this.links.saveSnapshotKey(linkId, key);
  }

  private async announce(
    linkId: string,
    previewStatus: PreviewStatus,
    previewVersion: number,
  ): Promise<void> {
    await this.notifier.publish(
      linkEnrichedEvent({ linkId, previewStatus, previewVersion }),
    );
  }
}
