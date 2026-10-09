import type { JobLinkSummary, LinkEnrichedPayload } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { JobLink } from '../domain/job-link';
import {
  displayNameIdsOf,
  previewAuthorIdsOf,
  toJobLinkSummary,
  toLinkSharer,
} from './link.mapper';
import {
  ENRICHMENT_BROADCASTER,
  type EnrichmentBroadcaster,
} from './ports/enrichment-broadcaster.port';
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
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';
import {
  visibleAuthorsByRecipient,
  type VisibleAuthors,
} from './visible-authors';

/**
 * Reparto de un aviso de enriquecimiento (D9 de link-enrichment, spec platform/realtime): quién puede ver ese link y
 * qué se le manda.
 *
 * **El aviso lleva el link dentro.** Sin eso la tarjeta no tendría de dónde leerlo: no hay `GET /api/links/:id` y la
 * spec prohíbe volver a pedir la lista entera. El precio está asumido y es este, por aviso: una lectura del link por su
 * id, una consulta de `group_links` y otra de `user_links` —las dos por el índice `{ linkId: 1 }`—, una por grupo para
 * sus miembros y una para los nombres visibles de la página. No es gratis; esconderlo sería peor.
 *
 * **El nombre de un autor del preview es de cada destinatario** (H1 de usage-guide-fixes, ADR-055 §2 y D3): cada uno
 * recibe su propio resumen, con `by: null` para los autores con los que no comparte ningún grupo. Se calcula con una
 * consulta por autor distinto (ninguna si el link no tiene autores humanos) **antes** de enviar nada: si falla, no se
 * reparte nada —nunca un resumen sin filtrar— y el fallo lo descarta y registra quien recibe el aviso.
 *
 * Lo que sí se evita es leer nada cuando **nadie escucha** en este proceso, que es el caso normal de un worker
 * trabajando de madrugada.
 *
 * El aviso trae `previewVersion`, pero el resumen se compone con lo que dice la base de datos, no con lo que dice el
 * aviso: si entre el aviso y este reparto alguien editó el preview a mano, lo que la pantalla tiene que ver es la
 * edición, no el estado que el worker dejó. El aviso dice "este link cambió", no "este es su contenido".
 */
@Injectable()
export class DeliverLinkEnriched {
  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(ENRICHMENT_BROADCASTER)
    private readonly broadcaster: EnrichmentBroadcaster,
  ) {}

  /** Reparte el aviso y devuelve a cuántas conexiones llegó. Cero es un resultado normal, no un error. */
  async execute(notice: LinkEnrichedPayload): Promise<number> {
    if (!this.broadcaster.hasListeners()) {
      return 0;
    }
    const link = await this.links.findById(notice.linkId);
    if (link === null) {
      // El link se borró entre el enriquecimiento y el aviso: no hay nada que pintar.
      return 0;
    }
    const recipients = await this.recipientsOf(link.id);
    if (recipients.size === 0) {
      return 0;
    }
    const visibleByRecipient = await visibleAuthorsByRecipient(
      this.membership,
      previewAuthorIdsOf([link]),
      [...recipients.keys()],
    );
    const names = await this.namesOf(link, recipients, visibleByRecipient);
    let delivered = 0;
    for (const [userId, seenThrough] of recipients) {
      const visibleAuthors = visibleByRecipient.get(userId);
      if (visibleAuthors === undefined) {
        // No debería pasar (hay un conjunto por destinatario); si pasa, no se manda nada sin filtrar.
        continue;
      }
      delivered += this.broadcaster.send(
        userId,
        summaryFor(link, seenThrough, names, visibleAuthors),
      );
    }
    return delivered;
  }

  /**
   * Quién puede ver el link y por qué relación lo ve. La lista privada va primero: es lo de la propia persona, y si
   * además está en un grupo suyo, la fecha que le corresponde es la de cuando lo guardó.
   */
  private async recipientsOf(
    linkId: string,
  ): Promise<Map<string, SeenThrough>> {
    const recipients = new Map<string, SeenThrough>();
    const shared = await this.groupLinks.relationsOfLink(linkId);
    const saved = await this.userLinks.relationsOfLink(linkId);

    for (const relation of shared) {
      const members = await this.membership.memberIdsOf([relation.groupId]);
      for (const userId of members) {
        if (!recipients.has(userId)) {
          recipients.set(userId, {
            sharedAt: relation.sharedAt,
            sharedBy: relation.sharedBy,
          });
        }
      }
    }
    for (const entry of saved) {
      recipients.set(entry.userId, { sharedAt: entry.savedAt });
    }
    return recipients;
  }

  /**
   * Nombres visibles de quien compartió y de quien escribió a mano algún campo, en una sola consulta. De los autores del
   * preview solo se piden los que algún destinatario puede ver.
   */
  private async namesOf(
    link: JobLink,
    recipients: Map<string, SeenThrough>,
    visibleByRecipient: ReadonlyMap<string, VisibleAuthors>,
  ): Promise<Map<string, string>> {
    const visibleToSomeone = new Set(
      [...visibleByRecipient.values()].flatMap((visible) => [...visible]),
    );
    const ids = displayNameIdsOf(
      [link],
      visibleToSomeone,
      [...recipients.values()].map((seen) => seen.sharedBy),
    );
    return ids.length === 0
      ? new Map<string, string>()
      : await this.directory.displayNamesOf(ids);
  }
}

/** Por dónde ve el link esa persona: cuándo llegó a su lista y, si fue por un grupo, quién lo compartió. */
interface SeenThrough {
  readonly sharedAt: Date;
  readonly sharedBy?: string;
}

function summaryFor(
  link: JobLink,
  seenThrough: SeenThrough,
  names: Map<string, string>,
  visibleAuthors: VisibleAuthors,
): JobLinkSummary {
  return toJobLinkSummary(link, {
    sharedAt: seenThrough.sharedAt,
    names,
    visibleAuthors,
    ...(seenThrough.sharedBy === undefined
      ? {}
      : {
          sharedBy: toLinkSharer(
            seenThrough.sharedBy,
            names.get(seenThrough.sharedBy),
          ),
        }),
  });
}
