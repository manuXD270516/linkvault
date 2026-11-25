import { WEEKLY_PLAN_SCAN_MAX } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { LinkNotFound } from '../domain/errors';
import { requireReadableLink } from './link-access';
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
  type JobLinkCard,
  type JobLinkRepository,
} from './ports/job-link-repository.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

export type { JobLinkCard } from './ports/job-link-repository.port';

/**
 * Señales de un link para «Tu semana» (D7 de weekly-plan). Frescura y **conteo** de «conozco a alguien»: el tipo no
 * tiene userIds ni nombres, así que ningún módulo puede obtener identidades por aquí.
 */
export interface LinkPlanSignals {
  readonly id: string;
  readonly displayUrl: string;
  readonly title?: string;
  readonly company?: string;
  /** `closedAt` presente. */
  readonly closed: boolean;
  /** `preview.expiresAt` `YYYY-MM-DD`; ausente si es `null` o no hay preview. */
  readonly expiresAt?: string;
  /** Marcas del grupo elegido sin contar a quien pregunta (C1). 0 si nadie más marcó. */
  readonly knowSomeoneCount: number;
  /** Grupo de quien pregunta con más marcas de otras personas (desempate `groupId` asc); ausente si el conteo es 0. */
  readonly knowSomeoneGroupId?: string;
}

// Única entrada de otros módulos a `links` (D1 de applications-tracking, spec links/sharing "Links disponibles para
// otros módulos"). Ningún archivo de dominio, aplicación o infraestructura de otro módulo lee las colecciones de links
// ni importa sus repositorios (lo comprueba el lint). Solo lecturas: guardar, compartir o quitar pasa por la API.
//
// Un identificador mal formado se trata como un link que no existe, sin error, igual que en los repositorios.

@Injectable()
export class LinksFacade {
  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  /**
   * `true` si la persona ve el link: lo tiene en su lista privada o está compartido en un grupo del que es miembro. Es
   * el mismo permiso que usan la edición del preview y el reintento de su lectura (`requireReadableLink`).
   */
  async canRead(userId: string, linkId: string): Promise<boolean> {
    try {
      await requireReadableLink(
        {
          links: this.links,
          groupLinks: this.groupLinks,
          userLinks: this.userLinks,
          membership: this.membership,
        },
        userId,
        linkId,
      );
      return true;
    } catch (error) {
      if (error instanceof LinkNotFound) {
        return false;
      }
      throw error;
    }
  }

  /** Fichas de esos links en una sola consulta; los que no existen o están mal formados no aportan nada. */
  async cardsOf(linkIds: readonly string[]): Promise<JobLinkCard[]> {
    return await this.links.cardsOf(linkIds);
  }

  /**
   * Lo que `match` necesita de una oferta: `previewVersion` y si hay título o texto con los que comparar. `null` si no
   * existe o el id está mal formado. No aplica el permiso: quien llama comprueba `canRead` antes.
   */
  async matchJobSummaryOf(linkId: string): Promise<{
    readonly id: string;
    readonly previewVersion: number;
    readonly title?: string;
    readonly description?: string;
  } | null> {
    const link = await this.links.findById(linkId);
    if (link === null) {
      return null;
    }
    const title = link.preview?.title;
    const description = link.preview?.summary;
    return {
      id: link.id,
      previewVersion: link.previewVersion,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    };
  }

  /**
   * Señales de plan de esos links para `userId` (D7 de weekly-plan): tres lecturas fijas —sus grupos y, en paralelo, las
   * fichas con frescura y las marcas «conozco a alguien»— sea cual sea el número de links. Por link, el conteo es el del
   * grupo de `userId` con más marcas de **otras** personas (no una unión entre grupos, C1), y lo acompaña ese `groupId`.
   * Con más de `WEEKLY_PLAN_SCAN_MAX` ids procesa solo los primeros. Los ids mal formados o inexistentes no aportan nada.
   */
  async planSignalsOf(
    userId: string,
    linkIds: readonly string[],
  ): Promise<ReadonlyMap<string, LinkPlanSignals>> {
    const ids = [...new Set(linkIds)].slice(0, WEEKLY_PLAN_SCAN_MAX);
    if (ids.length === 0) {
      return new Map();
    }
    const groupIds = (await this.membership.groupsOf(userId)).map(
      (group) => group.groupId,
    );
    const [cards, relations] = await Promise.all([
      this.links.planCardsOf(ids),
      this.groupLinks.knowSomeoneOf(groupIds, ids),
    ]);

    // Por link: el grupo con más marcas ajenas. Solo se conserva el conteo, nunca los ids de quienes marcaron.
    const best = new Map<string, { groupId: string; count: number }>();
    for (const relation of relations) {
      const count = relation.knowSomeoneUserIds.filter(
        (flagged) => flagged !== userId,
      ).length;
      const current = best.get(relation.linkId);
      if (
        current === undefined ||
        count > current.count ||
        (count === current.count && relation.groupId < current.groupId)
      ) {
        best.set(relation.linkId, { groupId: relation.groupId, count });
      }
    }

    const signals = new Map<string, LinkPlanSignals>();
    for (const card of cards) {
      const chosen = best.get(card.id);
      const count = chosen?.count ?? 0;
      signals.set(card.id, {
        id: card.id,
        displayUrl: card.displayUrl,
        ...(card.title === undefined ? {} : { title: card.title }),
        ...(card.company === undefined ? {} : { company: card.company }),
        closed: card.closed,
        ...(card.expiresAt === undefined ? {} : { expiresAt: card.expiresAt }),
        knowSomeoneCount: count,
        ...(chosen === undefined || count === 0
          ? {}
          : { knowSomeoneGroupId: chosen.groupId }),
      });
    }
    return signals;
  }

  /** De esos links, cuáles están compartidos ahora en el grupo, en una sola consulta. */
  async linkIdsSharedIn(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Set<string>> {
    return await this.groupLinks.linkIdsIn(groupId, linkIds);
  }
}
