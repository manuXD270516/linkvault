import type {
  EnrichmentFailureReason,
  PreviewStatus,
} from '@linkvault/shared';
import {
  withOriginalUrl,
  type JobLink,
  type NewJobLink,
} from '../../domain/job-link';
import { isLinkId } from '../../domain/identifier';
import type {
  JobLinkRepository,
  ManualPreviewWrite,
  ResolvedJobLink,
} from '../ports/job-link-repository.port';
import type { TransactionSession } from '../ports/transaction-session';
import { IN_MEMORY_SESSION } from './links-test-doubles';

// Repositorio de vacantes en memoria para tests de application (D10 de job-links). No es un adaptador de producción: el
// real es `MongoJobLinkRepository`. Aplica la misma clave de dedupe, el mismo historial acotado y el mismo predicado de
// identificador que él, para que un caso de uso probado aquí se comporte igual contra Mongo. Devuelve copias: un test no
// altera el estado por accidente.

export class InMemoryJobLinkRepository implements JobLinkRepository {
  private readonly links = new Map<string, JobLink>();
  private nextId = 1;

  /** Cuántas vacantes hay guardadas; lo usan los tests que comprueban que compartir no crea un link nuevo. */
  get size(): number {
    return this.links.size;
  }

  /** Todas las vacantes guardadas, en orden de alta. */
  get all(): JobLink[] {
    return [...this.links.values()].map((link) => structuredClone(link));
  }

  async withResolvedLink<T>(
    draft: NewJobLink,
    work: (resolved: ResolvedJobLink, session: TransactionSession) => Promise<T>,
  ): Promise<T> {
    return await work(this.resolve(draft), IN_MEMORY_SESSION);
  }

  findById(linkId: string): Promise<JobLink | null> {
    if (!isLinkId(linkId)) {
      return Promise.resolve(null);
    }
    const link = this.links.get(linkId);
    return Promise.resolve(link ? structuredClone(link) : null);
  }

  listByPreviewStatus(
    status: PreviewStatus,
    limit: number,
    reasons?: readonly EnrichmentFailureReason[],
  ): Promise<JobLink[]> {
    const matching = [...this.links.values()]
      .filter((link) => link.previewStatus === status)
      .filter(
        (link) =>
          reasons === undefined ||
          (link.lastEnrichmentError !== undefined &&
            reasons.includes(link.lastEnrichmentError.reason)),
      )
      // Mismo orden que el adaptador real: por identificador, que es por donde el comando avanza en tandas.
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, Math.max(0, limit));
    return Promise.resolve(matching.map((link) => structuredClone(link)));
  }

  updatePreview(
    linkId: string,
    expectedVersion: number,
    changes: ManualPreviewWrite,
  ): Promise<JobLink | null> {
    const link = isLinkId(linkId) ? this.links.get(linkId) : undefined;
    // Misma condición que el adaptador real: una versión que ya avanzó no casa y la edición no escribe nada.
    if (link === undefined || link.previewVersion !== expectedVersion) {
      return Promise.resolve(null);
    }
    const updated: JobLink = {
      ...link,
      preview: changes.preview,
      previewSources: changes.previewSources,
      previewStatus: 'manual',
      previewVersion: link.previewVersion + 1,
      updatedAt: changes.now,
    };
    this.links.set(link.id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  async withRequestedEnrichment<T>(
    linkId: string,
    now: Date,
    work: (link: JobLink, session: TransactionSession) => Promise<T>,
  ): Promise<T | null> {
    const link = isLinkId(linkId) ? this.links.get(linkId) : undefined;
    if (link === undefined) {
      return null;
    }
    const { lastEnrichmentError: _cleared, ...rest } = link;
    const updated: JobLink = {
      ...rest,
      previewStatus: 'pending',
      previewVersion: link.previewVersion + 1,
      previewRequestedAt: now,
      updatedAt: now,
    };
    this.links.set(link.id, updated);
    return await work(structuredClone(updated), IN_MEMORY_SESSION);
  }

  /** Alta directa para preparar un test, sin pasar por el caso de uso. */
  seed(draft: NewJobLink): JobLink {
    return structuredClone(this.resolve(draft).link);
  }

  /** Upsert por `dedupeKey`: crea la vacante o reutiliza la existente añadiendo la URL a su historial (D3). */
  private resolve(draft: NewJobLink): ResolvedJobLink {
    const existing = [...this.links.values()].find(
      (link) => link.dedupeKey === draft.dedupeKey,
    );
    if (existing !== undefined) {
      const updated = withOriginalUrl(
        existing,
        draft.displayUrl,
        draft.updatedAt,
      );
      this.links.set(existing.id, updated);
      return { link: structuredClone(updated), created: false };
    }
    const link: JobLink = { ...draft, id: this.nextLinkId() };
    this.links.set(link.id, link);
    return { link: structuredClone(link), created: true };
  }

  private nextLinkId(): string {
    const id = this.nextId.toString(16).padStart(24, '0');
    this.nextId += 1;
    return id;
  }
}
