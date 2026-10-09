import {
  scrubContactDetails,
  type JobLinkSummary,
  type PastedDescriptionRequest,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  AiQuotaExceeded,
  ExtractionUnavailable,
  LinkNotFound,
  NotAJobPosting,
  TooManyLinkAttempts,
} from '../domain/errors';
import type { JobLink } from '../domain/job-link';
import {
  AI_QUOTA_RETRY_AFTER_SECONDS,
  PASTE_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '../domain/limits';
import {
  applyPastedPreview,
  effectiveHeader,
  failureKeptAfterPaste,
  type PastedContent,
} from '../domain/preview-paste';
import { previewStatusOf } from '../domain/preview-status';
import { requireReadableLink, type ReadableLink } from './link-access';
import {
  displayNameIdsOf,
  previewAuthorIdsOf,
  toJobLinkSummary,
  toLinkSharer,
} from './link.mapper';
import { visibleAuthorsFor } from './visible-authors';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkRepository,
} from './ports/job-link-repository.port';
import {
  LINK_ENRICHED_PUBLISHER,
  type LinkEnrichedPublisher,
} from './ports/link-enriched-publisher.port';
import {
  LINK_LIMITER,
  type LinkLimitKey,
  type LinkLimiter,
} from './ports/link-limiter.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import {
  PASTED_EXTRACTION,
  type PastedExtraction,
  type PastedExtractionPort,
} from './ports/pasted-extraction.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

/**
 * `POST /api/links/:id/pasted` (spec links/pasted-description): completar una oferta pegando su texto, que se lee con la
 * IA dentro de la misma petición (D1 de paste-job-description).
 *
 * El orden es el de D5, y cada paso protege al siguiente:
 * 1. **Permiso de lectura** (404): quien no ve el link no sabe siquiera si existe.
 * 2. **Texto vacío tras la higiene** (422): un pegado que solo tenía un teléfono no gasta límite ni IA.
 * 3. **Límite de pegados**: con el contador caído, 503 —no "pegaste demasiadas" a quien no pegó ninguna—, y sin IA;
 *    agotado, 429.
 * 4. **La IA**: `isJobPosting: false` → 422 sin escribir; degradación o plazo agotado → 503, y el intento se devuelve;
 *    cuota diaria agotada → 429 `ai_quota_exceeded`.
 *
 * La escritura va **condicionada a la versión leída** y la sube, como la edición manual. Si otra escritura gana la
 * carrera, la mezcla se rehace sobre lo recién escrito **con la misma extracción**: volver a llamar a la IA gastaría
 * cuota y tiempo para leer el mismo texto.
 *
 * **El texto pegado vive solo en esta llamada.** No se guarda, no se registra y no viaja por el outbox ni por la cola;
 * lo que se escribe son los campos derivados de él. Tampoco sale en ningún error: ninguno lleva el texto.
 */
@Injectable()
export class PasteDescription {
  /** Intentos de la escritura: el segundo parte del preview que acaba de escribir otra escritura. */
  private static readonly MAX_ATTEMPTS = 3;

  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_LIMITER) private readonly limiter: LinkLimiter,
    @Inject(PASTED_EXTRACTION)
    private readonly extraction: PastedExtractionPort,
    @Inject(LINK_ENRICHED_PUBLISHER)
    private readonly publisher: LinkEnrichedPublisher,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  /** `clientClosed` se aborta si quien pegó cierra la conexión: la IA deja de leer para nadie. */
  async execute(
    userId: string,
    linkId: string,
    request: PastedDescriptionRequest,
    clientClosed?: AbortSignal,
  ): Promise<JobLinkSummary> {
    const readable = await requireReadableLink(this.readers(), userId, linkId);

    const text = scrubContactDetails(request.text);
    if (text === '') {
      throw new NotAJobPosting();
    }

    const limitKey: LinkLimitKey = { kind: 'paste-description', userId };
    const decision = await this.limiter.consume(limitKey);
    if (decision.unavailable === true) {
      throw new ExtractionUnavailable(decision.retryAfterSeconds);
    }
    if (!decision.allowed) {
      throw new TooManyLinkAttempts(decision.retryAfterSeconds);
    }

    const header = {
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.company === undefined ? {} : { company: request.company }),
    };
    // Lo que la persona dejó tal como estaba no es contexto nuevo: se ignora aquí igual que al escribir.
    const known = effectiveHeader(readable.link.preview, header);
    const extraction = await this.extraction.extract({
      userId,
      text,
      ...(known.title === undefined ? {} : { knownTitle: known.title }),
      ...(known.company === undefined ? {} : { knownCompany: known.company }),
      ...(clientClosed === undefined ? {} : { signal: clientClosed }),
    });
    const extracted = await this.fieldsOf(extraction, limitKey);

    const written = await this.write(userId, readable.link, {
      extracted,
      header,
    });
    if (written.changed) {
      this.announce(written.link);
    }
    return await this.toSummary(userId, readable, written.link);
  }

  /** Los campos leídos, o el error que corresponde a lo que respondió la IA. Un 503 devuelve el intento. */
  private async fieldsOf(
    extraction: PastedExtraction,
    limitKey: LinkLimitKey,
  ): Promise<PastedContent['extracted']> {
    switch (extraction.outcome) {
      case 'extracted':
        return extraction.fields;
      case 'not_a_job_posting':
        throw new NotAJobPosting();
      case 'quota_exceeded':
        throw new AiQuotaExceeded(AI_QUOTA_RETRY_AFTER_SECONDS);
      case 'unavailable':
        // La persona no pierde uno de sus pegados porque el proveedor no respondió.
        await this.limiter.refund(limitKey);
        throw new ExtractionUnavailable(PASTE_UNAVAILABLE_RETRY_AFTER_SECONDS);
    }
  }

  /**
   * Mezcla lo pegado con lo guardado y lo escribe condicionado a la versión. Si pierde la carrera, vuelve a leer y
   * rehace la mezcla con la **misma** extracción. Un pegado que no cambia ningún campo no escribe ni sube la versión.
   */
  private async write(
    userId: string,
    stored: JobLink,
    pasted: PastedContent,
  ): Promise<{ link: JobLink; changed: boolean }> {
    let current = stored;
    for (let attempt = 0; attempt < PasteDescription.MAX_ATTEMPTS; attempt++) {
      const now = this.clock.now();
      const merged = applyPastedPreview(current, pasted, userId, now);
      if (!merged.changed) {
        return { link: current, changed: false };
      }
      const kept = failureKeptAfterPaste(current.lastEnrichmentError);
      const written = await this.links.writePastedPreview(
        current.id,
        current.previewVersion,
        {
          preview: merged.preview,
          previewSources: merged.previewSources,
          previewStatus: previewStatusOf(
            merged.preview,
            merged.previewSources,
            kept,
          ),
          ...(kept === undefined ? {} : { lastEnrichmentError: kept }),
          now,
        },
      );
      if (written !== null) {
        return { link: written, changed: true };
      }
      const reread = await this.links.findById(current.id);
      if (reread === null) {
        throw new LinkNotFound();
      }
      current = reread;
    }
    throw new Error(
      'The pasted preview could not be saved after repeated conflicts',
    );
  }

  /** Avisa a las demás pantallas por el canal compartido, **sin esperar**: publicar nunca retrasa la respuesta. */
  private announce(link: JobLink): void {
    void this.publisher
      .publish({
        linkId: link.id,
        previewStatus: link.previewStatus,
        previewVersion: link.previewVersion,
      })
      // El puerto promete no lanzar; esto es por si un adaptador lo incumple, que no tumbe el proceso.
      .catch(() => undefined);
  }

  private readers() {
    return {
      links: this.links,
      groupLinks: this.groupLinks,
      userLinks: this.userLinks,
      membership: this.membership,
    };
  }

  /** El link con la forma de una fila de lista: quien pega lo está viendo en una. */
  private async toSummary(
    userId: string,
    readable: ReadableLink,
    link: JobLink,
  ): Promise<JobLinkSummary> {
    // El nombre de un autor del preview solo sale si quien lee comparte un grupo con él (H1, ADR-055 §2).
    const visibleAuthors = await visibleAuthorsFor(
      this.membership,
      userId,
      previewAuthorIdsOf([link]),
    );
    const ids = displayNameIdsOf(
      [link],
      visibleAuthors,
      readable.sharedBy === undefined ? [] : [readable.sharedBy],
    );
    const names =
      ids.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(ids);
    return toJobLinkSummary(link, {
      sharedAt: readable.sharedAt,
      names,
      visibleAuthors,
      ...(readable.sharedBy === undefined
        ? {}
        : {
            sharedBy: toLinkSharer(
              readable.sharedBy,
              names.get(readable.sharedBy),
            ),
          }),
    });
  }
}
