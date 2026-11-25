import type { GroupBriefOffer, GroupWeeklyBriefResponse } from '@linkvault/shared';

/** Una oferta válida contra `groupBriefOfferSchema`; el `linkId` (24 hex) se deriva del número. */
export function briefOfferWith(index: number, overrides: Partial<GroupBriefOffer> = {}): GroupBriefOffer {
  return {
    linkId: index.toString(16).padStart(24, '0'),
    displayUrl: `https://example.com/jobs/${index}`,
    title: `Oferta ${index}`,
    ...overrides,
  };
}

/** Semana de ejemplo: tres viñetas, 7 ofertas abiertas, actualizada el lunes 2026-11-23. */
export function groupBriefResponse(): GroupWeeklyBriefResponse {
  return {
    weekKey: '2026-W48',
    brief: {
      asOf: '2026-11-23',
      openOffers: 7,
      bullets: [
        {
          factId: 'closing_soon',
          fact: {
            kind: 'closing_soon',
            count: 2,
            from: '2026-11-23',
            until: '2026-11-30',
            firstExpiresAt: '2026-11-26',
          },
          offers: [
            briefOfferWith(1, { company: 'Acme', expiresAt: '2026-11-26' }),
            briefOfferWith(2, { expiresAt: '2026-11-28' }),
          ],
          moreCount: 0,
          missingCount: 0,
        },
        {
          factId: 'skill_demand:docker',
          fact: { kind: 'skill_demand', skillLabel: 'Docker', count: 4, total: 7 },
          offers: [briefOfferWith(3), briefOfferWith(4), briefOfferWith(5), briefOfferWith(6)],
          moreCount: 0,
          missingCount: 0,
        },
        {
          factId: 'shared_last_week',
          fact: { kind: 'shared_last_week', count: 3, weekKey: '2026-W47' },
          offers: [briefOfferWith(7), briefOfferWith(8), briefOfferWith(9)],
          moreCount: 0,
          missingCount: 0,
        },
      ],
    },
  };
}

export const EMPTY_GROUP_BRIEF: GroupWeeklyBriefResponse = { weekKey: '2026-W48', brief: null };
