import {
  GROUP_BRIEF_OFFERS_PER_BULLET,
  isoWeekKey,
  verifyGroupWeeklyBrief,
  type GroupBriefFact,
  type GroupBriefFactView,
  type GroupBriefOffer,
  type GroupWeeklyBriefResponse,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GroupNotFound } from '../../groups/domain/errors';
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
  GROUP_WEEKLY_BRIEF_READER,
  type GroupWeeklyBriefReader,
} from './ports/group-weekly-brief-reader.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkPlanCard,
  type JobLinkRepository,
} from './ports/job-link-repository.port';

type CitedFact = Exclude<GroupBriefFact, { kind: 'open_offers' }>;

/** De un hecho a su vista para el SPA: sin `linkIds` ni `factId`. */
function viewOf(fact: CitedFact): GroupBriefFactView {
  switch (fact.kind) {
    case 'closing_soon':
      return {
        kind: 'closing_soon',
        count: fact.count,
        from: fact.from,
        until: fact.until,
        firstExpiresAt: fact.firstExpiresAt,
      };
    case 'skill_demand':
      return {
        kind: 'skill_demand',
        skillLabel: fact.skillLabel,
        count: fact.count,
        total: fact.total,
      };
    case 'shared_last_week':
      return {
        kind: 'shared_last_week',
        count: fact.count,
        weekKey: fact.weekKey,
      };
  }
}

/**
 * `GET /api/groups/:id/weekly-brief` (design D8 de group-weekly-brief): «La semana del grupo». La api solo lee lo que
 * el worker calculó. Lecturas fijas, sea cual sea el número de viñetas: pertenencia, documento, relaciones que siguen
 * en el grupo y fichas. No escribe nada.
 *
 * Quien no es miembro recibe `group_not_found`, igual que si el grupo no existiera. Sin documento de **esta** semana,
 * con un documento que no cumple el contrato o que no pasa el evaluador, responde `brief: null`.
 */
@Injectable()
export class GetGroupWeeklyBrief {
  private readonly logger = new Logger(GetGroupWeeklyBrief.name);

  constructor(
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
    @Inject(GROUP_WEEKLY_BRIEF_READER)
    private readonly reader: GroupWeeklyBriefReader,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(JOB_LINK_REPOSITORY) private readonly jobLinks: JobLinkRepository,
  ) {}

  async execute(
    userId: string,
    groupId: string,
  ): Promise<GroupWeeklyBriefResponse> {
    if ((await this.membership.membershipOf(groupId, userId)) === null) {
      throw new GroupNotFound();
    }
    const weekKey = isoWeekKey(this.clock.now());
    const brief = await this.reader.findCurrent(groupId, weekKey);
    if (brief === null) {
      return { weekKey, brief: null };
    }
    if (brief === 'invalid') {
      this.logger.warn(
        `group_brief_unreadable groupId=${groupId} weekKey=${weekKey}`,
      );
      return { weekKey, brief: null };
    }
    const verdict = verifyGroupWeeklyBrief(brief);
    if (!verdict.ok) {
      this.logger.warn(
        `group_brief_rejected groupId=${groupId} weekKey=${weekKey} codes=${verdict.violations
          .map((violation) => violation.code)
          .join(',')}`,
      );
      return { weekKey, brief: null };
    }

    const openOffers = brief.facts.find((f) => f.kind === 'open_offers');
    const cited = brief.bullets.flatMap((bullet) => {
      const fact = brief.facts.find((f) => f.factId === bullet.factId);
      return fact === undefined || fact.kind === 'open_offers' ? [] : [fact];
    });

    // Dos lecturas, una por todas las viñetas: las relaciones que siguen en el grupo y las fichas de esas ofertas.
    const union = [...new Set(cited.flatMap((fact) => fact.linkIds))];
    const stillInGroup = await this.groupLinks.linkIdsIn(groupId, union);
    const cards = new Map<string, JobLinkPlanCard>(
      (await this.jobLinks.planCardsOf([...stillInGroup])).map((card) => [
        card.id,
        card,
      ]),
    );

    return {
      weekKey,
      brief: {
        asOf: brief.asOf,
        openOffers: openOffers?.count ?? 0,
        bullets: cited.map((fact) => {
          const survivors = fact.linkIds.flatMap((linkId) => {
            const card = cards.get(linkId);
            return stillInGroup.has(linkId) && card !== undefined ? [card] : [];
          });
          const offers = survivors
            .slice(0, GROUP_BRIEF_OFFERS_PER_BULLET)
            .map((card) => toOffer(card, fact.kind === 'closing_soon'));
          return {
            factId: fact.factId,
            fact: viewOf(fact),
            offers,
            moreCount: survivors.length - offers.length,
            missingCount: fact.count - survivors.length,
          };
        }),
      },
    };
  }
}

/** La ficha de una oferta; `expiresAt` solo viaja en las de `closing_soon` (R2-2). */
function toOffer(card: JobLinkPlanCard, withExpiry: boolean): GroupBriefOffer {
  return {
    linkId: card.id,
    displayUrl: card.displayUrl,
    ...(card.title === undefined ? {} : { title: card.title }),
    ...(card.company === undefined ? {} : { company: card.company }),
    ...(withExpiry && card.expiresAt !== undefined
      ? { expiresAt: card.expiresAt }
      : {}),
  };
}
