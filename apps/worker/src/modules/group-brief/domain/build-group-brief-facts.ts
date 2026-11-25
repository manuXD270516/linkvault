import {
  GROUP_BRIEF_SCAN_MAX,
  GROUP_BRIEF_SKILL_FACTS_MAX,
  GROUP_BRIEF_SKILL_MIN_OFFERS,
  WEEKLY_PLAN_CLOSING_SOON_DAYS,
  isoWeekKey,
  previousWeekKey,
  windowForWeekKey,
  type GroupBriefFact,
} from '@linkvault/shared';
import type { GroupBriefUniverse, UniverseOffer } from './group-brief-universe';
import { SKILL_KEY_MAX_LENGTH, pickSkillLabel, skillKeyOf } from './skill-key';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface GroupBriefFacts {
  /** En el orden: `open_offers`, `closing_soon`, `skill_demand`..., `shared_last_week`. */
  readonly facts: readonly GroupBriefFact[];
  /** Hubo más de `GROUP_BRIEF_SCAN_MAX` relaciones: solo queda para el RUNBOOK. */
  readonly scanTruncated: boolean;
}

/** Abierta: sin cierre detectado y con vencimiento ausente o no pasado (un `expiresAt` pasado cierra, ADR-041). */
function isOpen(offer: UniverseOffer, asOf: string): boolean {
  return (
    offer.closedAt === null &&
    (offer.expiresAt === null || offer.expiresAt >= asOf)
  );
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function skillFacts(open: readonly UniverseOffer[]): GroupBriefFact[] {
  const withSkills = open.map((offer) => {
    // Cada oferta cuenta una vez por clave aunque la repita; cada forma, también una vez por oferta.
    const forms = new Map<string, Set<string>>();
    for (const name of offer.skills) {
      const key = skillKeyOf(name);
      if (key === null) continue;
      const trimmed = name.trim();
      // Una forma de más de 60 caracteres (espacios internos) no cabe en el contrato: se muestra la clave.
      const form = trimmed.length > SKILL_KEY_MAX_LENGTH ? key : trimmed;
      const set = forms.get(key) ?? new Set<string>();
      set.add(form);
      forms.set(key, set);
    }
    return { id: offer.id, forms };
  });
  // `total` es el denominador honesto: abiertas con al menos una habilidad válida.
  const total = withSkills.filter((o) => o.forms.size > 0).length;

  const byKey = new Map<string, { ids: string[]; forms: string[] }>();
  for (const offer of withSkills) {
    for (const [key, forms] of offer.forms) {
      const entry = byKey.get(key) ?? { ids: [], forms: [] };
      entry.ids.push(offer.id);
      entry.forms.push(...forms);
      byKey.set(key, entry);
    }
  }

  return [...byKey.entries()]
    .filter(([, entry]) => entry.ids.length >= GROUP_BRIEF_SKILL_MIN_OFFERS)
    .sort(([keyA, a], [keyB, b]) =>
      a.ids.length !== b.ids.length
        ? b.ids.length - a.ids.length
        : compareStrings(keyA, keyB),
    )
    .slice(0, GROUP_BRIEF_SKILL_FACTS_MAX)
    .map(([skillKey, entry]): GroupBriefFact => ({
      kind: 'skill_demand',
      factId: `skill_demand:${skillKey}`,
      skillKey,
      skillLabel: pickSkillLabel(entry.forms),
      count: entry.ids.length,
      total,
      linkIds: entry.ids,
    }));
}

/** Hechos de la tabla de D3 sobre el universo. Puro: mismos datos y mismo `asOf`, mismos hechos. */
export function buildGroupBriefFacts(
  universe: GroupBriefUniverse,
): GroupBriefFacts {
  const { asOf } = universe;
  const scanTruncated = universe.offers.length > GROUP_BRIEF_SCAN_MAX;
  const offers = universe.offers.slice(0, GROUP_BRIEF_SCAN_MAX);
  const open = offers.filter((o) => isOpen(o, asOf));

  const facts: GroupBriefFact[] = [
    {
      kind: 'open_offers',
      factId: 'open_offers',
      count: open.length,
      linkIds: open.map((o) => o.id),
    },
  ];

  const until = addDays(asOf, WEEKLY_PLAN_CLOSING_SOON_DAYS);
  const closing = open.filter(
    (o) => o.expiresAt !== null && o.expiresAt >= asOf && o.expiresAt <= until,
  );
  const expiries = closing.map((o) => o.expiresAt ?? asOf).sort();
  const firstExpiresAt = expiries[0];
  if (firstExpiresAt !== undefined) {
    facts.push({
      kind: 'closing_soon',
      factId: 'closing_soon',
      count: closing.length,
      linkIds: closing.map((o) => o.id),
      from: asOf,
      until,
      firstExpiresAt,
    });
  }

  facts.push(...skillFacts(open));

  const weekKey = isoWeekKey(new Date(`${asOf}T00:00:00Z`));
  const previous = previousWeekKey(weekKey);
  const { start, end } = windowForWeekKey(previous);
  const shared = offers.filter((o) => {
    const t = Date.parse(o.sharedAt);
    return t >= start.getTime() && t < end.getTime();
  });
  if (shared.length > 0) {
    facts.push({
      kind: 'shared_last_week',
      factId: 'shared_last_week',
      count: shared.length,
      linkIds: shared.map((o) => o.id),
      weekKey: previous,
    });
  }

  return { facts, scanTruncated };
}
