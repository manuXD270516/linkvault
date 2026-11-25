import {
  GROUP_BRIEF_MAX_BULLETS,
  GROUP_BRIEF_SKILL_BULLETS_MAX,
  type GroupBriefBullet,
  type GroupBriefFact,
} from '@linkvault/shared';

/**
 * Viñetas por plantilla (design D5), en este orden y saltando lo que no existe: `closing_soon`, la primera
 * `skill_demand`, `shared_last_week` y la segunda `skill_demand`. `open_offers` es la cabecera, no una viñeta.
 * Una viñeta solo cita un hecho: no lleva texto ni números propios.
 */
export function selectGroupBriefBullets(
  facts: readonly GroupBriefFact[],
): readonly GroupBriefBullet[] {
  const closing = facts.filter((f) => f.kind === 'closing_soon');
  const skills = facts
    .filter((f) => f.kind === 'skill_demand')
    .slice(0, GROUP_BRIEF_SKILL_BULLETS_MAX);
  const shared = facts.filter((f) => f.kind === 'shared_last_week');

  return [...closing, ...skills.slice(0, 1), ...shared, ...skills.slice(1)]
    .slice(0, GROUP_BRIEF_MAX_BULLETS)
    .map((fact) => ({ factId: fact.factId, source: 'template' as const }));
}
