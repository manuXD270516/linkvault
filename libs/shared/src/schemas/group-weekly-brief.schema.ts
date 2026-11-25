import { z } from 'zod';
import { isoWeekKeySchema } from '../time/iso-week';

// Contrato de «La semana del grupo» (change group-weekly-brief, design D7, ADR-069). El documento de Mongo es un tipo
// de infraestructura y no vive aquí. Los hechos llevan `linkIds`; la vista para el SPA no.

export const GROUP_BRIEF_MAX_BULLETS = 4;
export const GROUP_BRIEF_SKILL_BULLETS_MAX = 2;
export const GROUP_BRIEF_SKILL_FACTS_MAX = 5;
export const GROUP_BRIEF_SKILL_MIN_OFFERS = 2;
export const GROUP_BRIEF_SCAN_MAX = 500;
export const GROUP_BRIEF_OFFERS_PER_BULLET = 10;
/** La ventana de cierre reutiliza `WEEKLY_PLAN_CLOSING_SOON_DAYS` (7). */
export const GROUP_BRIEF_TTL_DAYS = 35;

const int = z.number().int();
const objectIdString = z.string().regex(/^[0-9a-f]{24}$/);
const linkIds = z.array(objectIdString).max(GROUP_BRIEF_SCAN_MAX);

export const groupBriefFactSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('open_offers'),
    factId: z.literal('open_offers'),
    count: int.min(0),
    linkIds,
  }),
  z.strictObject({
    kind: z.literal('closing_soon'),
    factId: z.literal('closing_soon'),
    count: int.min(1),
    linkIds,
    from: z.iso.date(),
    until: z.iso.date(),
    firstExpiresAt: z.iso.date(),
  }),
  z.strictObject({
    kind: z.literal('skill_demand'),
    factId: z.string().regex(/^skill_demand:.{1,60}$/),
    skillKey: z.string().min(1).max(60),
    skillLabel: z.string().min(1).max(60),
    count: int.min(GROUP_BRIEF_SKILL_MIN_OFFERS),
    total: int.min(GROUP_BRIEF_SKILL_MIN_OFFERS),
    linkIds,
  }),
  z.strictObject({
    kind: z.literal('shared_last_week'),
    factId: z.literal('shared_last_week'),
    count: int.min(1),
    linkIds,
    weekKey: isoWeekKeySchema,
  }),
]);
export type GroupBriefFact = z.infer<typeof groupBriefFactSchema>;
export type GroupBriefFactKind = GroupBriefFact['kind'];

/** Una viñeta no lleva texto ni números propios: cita un hecho. */
export const groupBriefBulletSchema = z.strictObject({
  factId: z.string().min(1),
  source: z.literal('template'),
});
export type GroupBriefBullet = z.infer<typeof groupBriefBulletSchema>;

export const groupWeeklyBriefSchema = z.strictObject({
  version: z.literal(1),
  groupId: objectIdString,
  weekKey: isoWeekKeySchema,
  asOf: z.iso.date(),
  computedAt: z.iso.datetime(),
  scanTruncated: z.boolean(),
  facts: z.array(groupBriefFactSchema).min(1).max(8),
  bullets: z.array(groupBriefBulletSchema).min(1).max(GROUP_BRIEF_MAX_BULLETS),
});
export type GroupWeeklyBrief = z.infer<typeof groupWeeklyBriefSchema>;

/** Vista para el SPA, variante por variante: los hechos sin `linkIds` y sin `open_offers`. */
export const groupBriefFactViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('closing_soon'),
    count: int.min(1),
    from: z.iso.date(),
    until: z.iso.date(),
    firstExpiresAt: z.iso.date(),
  }),
  z.strictObject({
    kind: z.literal('skill_demand'),
    skillLabel: z.string().min(1).max(60),
    count: int.min(GROUP_BRIEF_SKILL_MIN_OFFERS),
    total: int.min(GROUP_BRIEF_SKILL_MIN_OFFERS),
  }),
  z.strictObject({
    kind: z.literal('shared_last_week'),
    count: int.min(1),
    weekKey: isoWeekKeySchema,
  }),
]);
export type GroupBriefFactView = z.infer<typeof groupBriefFactViewSchema>;

export const groupBriefOfferSchema = z.strictObject({
  linkId: objectIdString,
  displayUrl: z.string().min(1),
  title: z.string().optional(),
  company: z.string().optional(),
  /** Solo en las ofertas de `closing_soon`. */
  expiresAt: z.iso.date().optional(),
});
export type GroupBriefOffer = z.infer<typeof groupBriefOfferSchema>;

export const groupWeeklyBriefResponseSchema = z.strictObject({
  /** La semana en curso, haya documento o no. */
  weekKey: isoWeekKeySchema,
  brief: z
    .strictObject({
      asOf: z.iso.date(),
      openOffers: int.min(0),
      bullets: z
        .array(
          z.strictObject({
            factId: z.string().min(1),
            fact: groupBriefFactViewSchema,
            offers: z
              .array(groupBriefOfferSchema)
              .max(GROUP_BRIEF_OFFERS_PER_BULLET),
            moreCount: int.min(0),
            missingCount: int.min(0),
          }),
        )
        .min(1)
        .max(GROUP_BRIEF_MAX_BULLETS),
    })
    .nullable(),
});
export type GroupWeeklyBriefResponse = z.infer<
  typeof groupWeeklyBriefResponseSchema
>;
