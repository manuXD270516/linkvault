import {
  isRetryableEnrichmentReason,
  linkCreatedEvent,
  type EnrichLinkResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  EnrichmentNotRetryable,
  LinkNotFound,
  TooManyLinkAttempts,
} from '../domain/errors';
import type { JobLink } from '../domain/job-link';
import { requireReadableLink, type ReadableLink } from './link-access';
import { displayNameIdsOf, toJobLinkSummary, toLinkSharer } from './link.mapper';
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
import { LINK_LIMITER, type LinkLimiter } from './ports/link-limiter.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import { OUTBOX, type Outbox } from '../../../infrastructure/outbox/outbox.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

/**
 * `POST /api/links/:id/enrich` (spec links/enrichment): volver a pedir la lectura de una oferta, para quien la ve.
 *
 * **No toca BullMQ** (D10). Hace exactamente lo mismo que el alta de un link: en una transacción sube `previewVersion`,
 * vuelve a `pending`, limpia el motivo del fallo anterior, apunta `previewRequestedAt` y escribe `LinkCreated.v1` en el
 * outbox; el relay lo publica. Eso resuelve tres cosas a la vez: la `Queue` vive en `OutboxRelayModule` y montar una
 * segunda aquí obligaría a la suite de integración de `api` a tener Redis (ADR-021 §4); el `jobId` determinista incluye
 * la versión, así que subirla deja de tropezar con el job terminal que la cola retiene una semana; y no hay dual-write,
 * porque la verdad sigue siendo una transacción de Mongo.
 *
 * El orden de las comprobaciones importa: primero si se puede ver, luego si tiene sentido reintentar y solo entonces el
 * contador. Un `409` no gasta cuota, que si no bastaría con insistir sobre un link bloqueado para quedarse sin ella.
 */
@Injectable()
export class RequestLinkEnrichment {
  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(LINK_LIMITER) private readonly limiter: LinkLimiter,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, linkId: string): Promise<EnrichLinkResponse> {
    const readable = await requireReadableLink(this.readers(), userId, linkId);
    assertRetryable(readable.link);

    const decision = await this.limiter.consume({ kind: 'enrich-link', linkId });
    if (!decision.allowed) {
      throw new TooManyLinkAttempts(decision.retryAfterSeconds);
    }

    const requested = await this.links.withRequestedEnrichment(
      linkId,
      this.clock.now(),
      async (link, session) => {
        await this.outbox.append(
          linkCreatedEvent({
            linkId: link.id,
            previewVersion: link.previewVersion,
          }),
          session,
        );
        return link;
      },
    );
    if (requested === null) {
      throw new LinkNotFound();
    }
    return await this.toSummary(readable, requested);
  }

  private readers() {
    return {
      links: this.links,
      groupLinks: this.groupLinks,
      userLinks: this.userLinks,
      membership: this.membership,
    };
  }

  private async toSummary(
    readable: ReadableLink,
    link: JobLink,
  ): Promise<EnrichLinkResponse> {
    const ids = displayNameIdsOf(
      [link],
      readable.sharedBy === undefined ? [] : [readable.sharedBy],
    );
    const names =
      ids.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(ids);
    return toJobLinkSummary(link, {
      sharedAt: readable.sharedAt,
      names,
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

/**
 * Rechaza la relectura de lo que no se puede volver a leer: la bolsa prohíbe la lectura, la bolsa nos bloquea o lo
 * compartido no era una oferta. Se mira el motivo del último fallo y no el estado, porque es el motivo el que dice si
 * volver a pedir la página cambiaría algo.
 */
function assertRetryable(link: JobLink): void {
  const reason = link.lastEnrichmentError?.reason;
  if (reason !== undefined && !isRetryableEnrichmentReason(reason)) {
    throw new EnrichmentNotRetryable();
  }
}
