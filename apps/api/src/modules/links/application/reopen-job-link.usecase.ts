import type { JobLinkSummary, ReopenLinkRequest } from '@linkvault/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { SearchFacade } from '../../search/application/search.facade';
import { InvalidExpiresAt, LinkNotFound } from '../domain/errors';
import type { JobLink } from '../domain/job-link';
import { applyManualEdit } from '../domain/preview-edit';
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
  type ReopenLinkWrite,
} from './ports/job-link-repository.port';
import {
  LINK_ENRICHED_PUBLISHER,
  type LinkEnrichedPublisher,
} from './ports/link-enriched-publisher.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

/**
 * `POST /api/links/:id/reopen` (ADR-041): deshace un cierre de frescura. ACL = `requireReadableLink` (igual que
 * editar preview). Idempotente si ya abierto (sin mutar, aunque `expiresAt` esté pasado). No toca applications
 * `expired`. Calendar / `expiresAt` pasado exige body `expiresAt` futuro o `null`.
 */
@Injectable()
export class ReopenJobLink {
  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
    @Inject(LINK_ENRICHED_PUBLISHER)
    private readonly publisher: LinkEnrichedPublisher,
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Optional() private readonly search?: SearchFacade,
  ) {}

  async execute(
    userId: string,
    linkId: string,
    request: ReopenLinkRequest,
  ): Promise<JobLinkSummary> {
    const readable = await requireReadableLink(this.readers(), userId, linkId);
    const current = readable.link;

    // Ya abierto: 200 sin mutar (incluso con expiresAt pasado o body con expiresAt).
    if (current.closedAt === undefined) {
      return await this.toSummary(userId, readable, current);
    }

    this.assertCalendarTrap(current, request);

    const now = this.clock.now();
    const write = this.reopenWrite(current, request, userId, now);
    const written = await this.links.reopen(linkId, write);
    if (written !== null) {
      this.announce(written);
      await this.emitSearch(written, now);
      return await this.toSummary(userId, readable, written);
    }

    // Carrera: otro proceso lo reabrió entre la lectura y la escritura → idempotente sin mutar de nuevo.
    const reread = await this.links.findById(linkId);
    if (reread === null) {
      throw new LinkNotFound();
    }
    if (reread.closedAt === undefined) {
      return await this.toSummary(userId, readable, reread);
    }
    throw new Error('The link could not be reopened');
  }

  /**
   * Si `closedReason === 'calendar'` o la `expiresAt` resultante (día UTC) está en el pasado, el body tiene que
   * aportar `expiresAt` futuro o `null`. Solo aplica cuando había `closedAt`.
   */
  private assertCalendarTrap(link: JobLink, request: ReopenLinkRequest): void {
    const today = utcDateOnly(this.clock.now());
    const resulting =
      request.expiresAt !== undefined
        ? request.expiresAt
        : link.preview?.expiresAt;
    const pastOrCalendar =
      link.closedReason === 'calendar' || isPastDateOnly(resulting, today);
    if (!pastOrCalendar) {
      return;
    }
    if (request.expiresAt === undefined) {
      throw new InvalidExpiresAt();
    }
    if (
      request.expiresAt !== null &&
      isPastDateOnly(request.expiresAt, today)
    ) {
      throw new InvalidExpiresAt();
    }
  }

  private reopenWrite(
    link: JobLink,
    request: ReopenLinkRequest,
    userId: string,
    now: Date,
  ): ReopenLinkWrite {
    if (request.expiresAt === undefined) {
      return { now };
    }
    const edited = applyManualEdit(
      link,
      { fields: { expiresAt: request.expiresAt } },
      userId,
      now,
    );
    if (!edited.changed) {
      return { now };
    }
    return {
      now,
      preview: {
        preview: edited.preview,
        previewSources: edited.previewSources,
        previewStatus: previewStatusOf(
          edited.preview,
          edited.previewSources,
          link.lastEnrichmentError,
        ),
        now,
      },
    };
  }

  private announce(link: JobLink): void {
    void this.publisher
      .publish({
        linkId: link.id,
        previewStatus: link.previewStatus,
        previewVersion: link.previewVersion,
      })
      .catch(() => undefined);
  }

  private async emitSearch(link: JobLink, at: Date): Promise<void> {
    if (this.search?.enabled !== true) return;
    const search = this.search;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await search.upsert(
          {
            docType: 'job_preview',
            aggregateId: link.id,
            reason: 'preview_updated',
            fingerprint: `job_preview:${link.id}:reopen:${at.toISOString()}`,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
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
    userId: string,
    readable: ReadableLink,
    link: typeof readable.link,
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

/** Día calendario UTC `YYYY-MM-DD` (mismo contrato que `preview.expiresAt`). */
export function utcDateOnly(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** `expiresAt` date-only estrictamente anterior a hoy UTC. `null` / ausente no son pasado. */
export function isPastDateOnly(
  expiresAt: string | null | undefined,
  todayUtc: string,
): boolean {
  return typeof expiresAt === 'string' && expiresAt < todayUtc;
}
