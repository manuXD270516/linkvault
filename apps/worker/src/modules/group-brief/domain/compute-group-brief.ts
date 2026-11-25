import { isoWeekKey, type GroupWeeklyBrief } from '@linkvault/shared';
import { buildGroupBriefFacts } from './build-group-brief-facts';
import type { UniverseOffer } from './group-brief-universe';
import { selectGroupBriefBullets } from './select-group-brief-bullets';

export interface ComputeGroupBriefInput {
  readonly groupId: string;
  readonly now: Date;
  /** Ofertas del universo, ya en su orden (`sharedAt` desc, `id` desc). */
  readonly offers: readonly UniverseOffer[];
}

/**
 * La semana del grupo para `now`: la semana ISO en curso y `asOf` = la fecha UTC. Devuelve `null` si no hay ninguna
 * viñeta (D2: ese día el grupo no tiene nada que decir). Puro: mismo universo y mismo reloj, mismo resultado.
 */
export function computeGroupBrief(
  input: ComputeGroupBriefInput,
): GroupWeeklyBrief | null {
  const asOf = input.now.toISOString().slice(0, 10);
  const { facts, scanTruncated } = buildGroupBriefFacts({
    asOf,
    offers: input.offers,
  });
  const bullets = selectGroupBriefBullets(facts);
  if (bullets.length === 0) {
    return null;
  }
  return {
    version: 1,
    groupId: input.groupId,
    weekKey: isoWeekKey(input.now),
    asOf,
    computedAt: input.now.toISOString(),
    scanTruncated,
    facts: [...facts],
    bullets: [...bullets],
  };
}
