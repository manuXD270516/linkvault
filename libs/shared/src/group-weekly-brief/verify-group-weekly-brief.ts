import {
  GROUP_BRIEF_MAX_BULLETS,
  GROUP_BRIEF_SKILL_BULLETS_MAX,
  type GroupBriefFact,
  type GroupWeeklyBrief,
} from '../schemas/group-weekly-brief.schema';
import { WEEKLY_PLAN_CLOSING_SOON_DAYS } from '../schemas/weekly-plan.schema';
import { previousWeekKey } from '../time/iso-week';

// Evaluador determinista de «La semana del grupo» (design D6). Función pura sobre el contrato; corre en el worker
// antes de escribir y en la api al leer. Las violaciones llevan código y, si aplica, el `factId`: nunca contenido.

export const GROUP_BRIEF_VIOLATION_CODES = [
  'duplicate_fact_id',
  'open_offers_missing',
  'fact_id_kind_mismatch',
  'bullet_fact_missing',
  'bullet_cites_open_offers',
  'duplicate_bullet',
  'too_many_bullets',
  'too_many_skill_bullets',
  'count_mismatch',
  'duplicate_link_id',
  'not_subset_of_open',
  'skill_total_invalid',
  'closing_window_invalid',
  'previous_week_invalid',
] as const;
export type GroupBriefViolationCode =
  (typeof GROUP_BRIEF_VIOLATION_CODES)[number];

export interface GroupBriefViolation {
  readonly code: GroupBriefViolationCode;
  readonly factId?: string;
}

export type GroupBriefVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly GroupBriefViolation[] };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `asOf` + `days` días como `YYYY-MM-DD`, o `null` si `asOf` no es una fecha. */
function addDays(isoDate: string, days: number): string | null {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(t)
    ? null
    : new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function verifyGroupWeeklyBrief(
  brief: GroupWeeklyBrief,
): GroupBriefVerdict {
  const violations: GroupBriefViolation[] = [];
  const add = (code: GroupBriefViolationCode, factId?: string): void => {
    violations.push(factId === undefined ? { code } : { code, factId });
  };

  // 1. Identificadores de hecho.
  const byId = new Map<string, GroupBriefFact>();
  for (const fact of brief.facts) {
    if (byId.has(fact.factId)) add('duplicate_fact_id', fact.factId);
    else byId.set(fact.factId, fact);
    const expected =
      fact.kind === 'skill_demand'
        ? `skill_demand:${fact.skillKey}`
        : fact.kind;
    if (fact.factId !== expected) add('fact_id_kind_mismatch', fact.factId);
  }
  const open = brief.facts.find((f) => f.kind === 'open_offers');
  if (open === undefined) add('open_offers_missing');
  const openIds = new Set(open?.linkIds ?? []);

  // 2. Viñetas.
  if (brief.bullets.length > GROUP_BRIEF_MAX_BULLETS) add('too_many_bullets');
  const seenBullets = new Set<string>();
  let skillBullets = 0;
  for (const bullet of brief.bullets) {
    if (seenBullets.has(bullet.factId)) add('duplicate_bullet', bullet.factId);
    seenBullets.add(bullet.factId);
    const cited = byId.get(bullet.factId);
    if (cited === undefined) add('bullet_fact_missing', bullet.factId);
    else if (cited.kind === 'open_offers')
      add('bullet_cites_open_offers', bullet.factId);
    else if (cited.kind === 'skill_demand') skillBullets += 1;
  }
  if (skillBullets > GROUP_BRIEF_SKILL_BULLETS_MAX)
    add('too_many_skill_bullets');

  for (const fact of brief.facts) {
    // 3. Cuenta y repetidos.
    if (fact.count !== fact.linkIds.length) add('count_mismatch', fact.factId);
    if (new Set(fact.linkIds).size !== fact.linkIds.length)
      add('duplicate_link_id', fact.factId);

    // 4. Subconjunto de las abiertas.
    if (
      fact.kind !== 'open_offers' &&
      fact.kind !== 'shared_last_week' &&
      fact.linkIds.some((id) => !openIds.has(id))
    ) {
      add('not_subset_of_open', fact.factId);
    }
    if (
      fact.kind === 'skill_demand' &&
      !(fact.count <= fact.total && fact.total <= (open?.count ?? 0))
    ) {
      add('skill_total_invalid', fact.factId);
    }

    // 5. Fechas.
    if (fact.kind === 'closing_soon') {
      const until = addDays(brief.asOf, WEEKLY_PLAN_CLOSING_SOON_DAYS);
      if (
        fact.from !== brief.asOf ||
        until === null ||
        fact.until !== until ||
        fact.firstExpiresAt < fact.from ||
        fact.firstExpiresAt > fact.until
      ) {
        add('closing_window_invalid', fact.factId);
      }
    }
    if (
      fact.kind === 'shared_last_week' &&
      fact.weekKey !== previousWeekKey(brief.weekKey)
    ) {
      add('previous_week_invalid', fact.factId);
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
