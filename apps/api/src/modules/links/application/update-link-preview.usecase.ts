import type { JobLinkSummary, UpdatePreviewRequest } from '@linkvault/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { LinkNotFound } from '../domain/errors';
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
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { SearchFacade } from '../../search/application/search.facade';

/**
 * `PATCH /api/links/:id/preview` (spec links/enrichment): corregir a mano lo que la extracción leyó mal, o devolver un
 * campo a lo que leyó. Puede hacerlo cualquiera que vea el link: el `JobLink` es canónico y compartido, así que
 * corregir su título beneficia a todos los grupos donde esté; quien no lo ve recibe `link_not_found`.
 *
 * La escritura va **condicionada a la versión leída** y sube `previewVersion` (D2). Eso es lo que impide que un
 * enriquecimiento que empezó antes de la edición la pise al terminar: cuando intente escribir, su versión ya no casará.
 * Si la carrera se pierde al revés —el enriquecimiento escribió entre la lectura y la edición—, la edición se rehace
 * sobre lo recién escrito en vez de descartarse, que es lo que la persona espera al pulsar guardar.
 *
 * Una petición que no pide ningún cambio NO sube la versión: subirla mataría un enriquecimiento en vuelo a cambio de
 * nada. "Ningún cambio" incluye reenviar un campo con el valor que ya tenía escrito a mano, que es lo que hace el SPA
 * cuando alguien guarda dos veces el mismo formulario.
 *
 * Una corrección que se escribe se anuncia en el canal de avisos, como un enriquecimiento, para que las demás pantallas
 * abiertas la vean (spec platform/realtime, "Una corrección a mano también llega").
 */
@Injectable()
export class UpdateLinkPreview {
  /** Intentos de la edición: el segundo parte del preview que acaba de escribir el enriquecimiento. */
  private static readonly MAX_ATTEMPTS = 3;

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
    request: UpdatePreviewRequest,
  ): Promise<JobLinkSummary> {
    const readable = await requireReadableLink(this.readers(), userId, linkId);
    const edit = {
      ...(request.fields === undefined ? {} : { fields: request.fields }),
      ...(request.revert === undefined ? {} : { revert: request.revert }),
    };

    let current = readable.link;
    for (let attempt = 0; attempt < UpdateLinkPreview.MAX_ATTEMPTS; attempt++) {
      const edited = applyManualEdit(current, edit, userId, this.clock.now());
      if (!edited.changed) {
        return await this.toSummary(userId, readable, current);
      }
      const written = await this.links.updatePreview(
        linkId,
        current.previewVersion,
        {
          preview: edited.preview,
          previewSources: edited.previewSources,
          // Escribir a mano deja `manual`; volver atrás deja lo que corresponde a los campos que quedan, y un link
          // que se queda sin nada vuelve a `failed` con el motivo que conservaba, o a `pending` si nunca falló.
          previewStatus: previewStatusOf(
            edited.preview,
            edited.previewSources,
            current.lastEnrichmentError,
          ),
          now: this.clock.now(),
        },
      );
      if (written !== null) {
        this.announce(written);
        await this.emitSearch(written);
        return await this.toSummary(userId, readable, written);
      }
      // Otra escritura ganó: se vuelve a leer y la corrección se aplica sobre lo que hay ahora.
      const reread = await this.links.findById(linkId);
      if (reread === null) {
        throw new LinkNotFound();
      }
      current = reread;
    }
    throw new Error('The preview could not be saved after repeated conflicts');
  }

  /**
   * Avisa a las demás pantallas por el canal compartido (D6 de paste-job-description), **sin esperar**: publicar nunca
   * retrasa ni hace fallar la respuesta de quien corrigió.
   */
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

  private async emitSearch(link: JobLink): Promise<void> {
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
            fingerprint: `preview:${link.id}:${link.previewVersion}:${link.preview?.title ?? ''}`,
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

  /** El link editado con la forma de una fila de lista: quien lo edita lo está viendo en una. */
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
