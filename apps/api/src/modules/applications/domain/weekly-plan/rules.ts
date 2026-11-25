import {
  APPLICATION_STALE_AFTER_DAYS,
  WEEKLY_PLAN_CLOSING_SOON_DAYS,
  WEEKLY_PLAN_HIGH_FIT_SCORE,
  type WeeklyPlanReason,
  type WeeklyPlanRule,
} from '@linkvault/shared';
import type { PlanCandidate, PlanCandidateFacts } from './weekly-plan';

// Las tres reglas de D2, evaluadas en orden de prioridad. Cada postulación produce como mucho una candidata: la de la
// primera regla que cumple. Funciones puras: sin reloj, sin E/S.

/** Orden de prioridad de las reglas (también el de los turnos de D3). */
export const RULE_ORDER: readonly WeeklyPlanRule[] = [
  'apply_before_close',
  'follow_up',
  'ask_know_someone',
];

function candidate(
  rule: WeeklyPlanRule,
  facts: PlanCandidateFacts,
  reason: WeeklyPlanReason,
): PlanCandidate {
  return { candidateId: `${rule}:${facts.key}`, rule, key: facts.key, reason };
}

/** `saved` o `interested` que vence en los próximos 7 días o encaja alto con un análisis no degradado. */
function applyBeforeClose(facts: PlanCandidateFacts): PlanCandidate | null {
  if (facts.status !== 'saved' && facts.status !== 'interested') {
    return null;
  }
  const daysLeft = facts.daysUntilExpiry;
  if (facts.expiresAt !== undefined && daysLeft !== undefined) {
    // Un `expiresAt` pasado sin `closedAt` es un cierre de calendario (ADR-041): ni por fecha ni por encaje (C2).
    if (daysLeft < 0) {
      return null;
    }
    if (daysLeft <= WEEKLY_PLAN_CLOSING_SOON_DAYS) {
      return candidate('apply_before_close', facts, {
        kind: 'closing_soon',
        expiresAt: facts.expiresAt,
        daysLeft,
      });
    }
  }
  // C7: el `RuleBasedMatcher` (degradado) no es señal suficiente para decir «encaja».
  if (
    facts.fit !== undefined &&
    !facts.fit.degraded &&
    facts.fit.score >= WEEKLY_PLAN_HIGH_FIT_SCORE
  ) {
    return candidate('apply_before_close', facts, {
      kind: 'high_fit',
      score: facts.fit.score,
    });
  }
  return null;
}

/** `applied` o `in_process` con 10 días o más sin cambio de estado. */
function followUp(facts: PlanCandidateFacts): PlanCandidate | null {
  if (facts.status !== 'applied' && facts.status !== 'in_process') {
    return null;
  }
  if (facts.daysQuiet < APPLICATION_STALE_AFTER_DAYS) {
    return null;
  }
  return candidate('follow_up', facts, {
    kind: 'quiet',
    daysQuiet: facts.daysQuiet,
    status: facts.status,
    ...(facts.appliedAt === undefined ? {} : { appliedAt: facts.appliedAt }),
  });
}

/** Postulación abierta y sin cerrar con al menos otra persona del grupo que «conoce a alguien» en ese link. */
function askKnowSomeone(facts: PlanCandidateFacts): PlanCandidate | null {
  if (
    facts.status !== 'saved' &&
    facts.status !== 'interested' &&
    facts.status !== 'applied' &&
    facts.status !== 'in_process'
  ) {
    return null;
  }
  if (facts.knowSomeone === undefined || facts.knowSomeone.count < 1) {
    return null;
  }
  return candidate('ask_know_someone', facts, {
    kind: 'know_someone',
    count: facts.knowSomeone.count,
    groupId: facts.knowSomeone.groupId,
  });
}

/**
 * La candidata de la postulación: la de la primera regla que cumple (en `RULE_ORDER`), o `null`. Un link cerrado no
 * produce nada.
 */
export function evaluateRules(facts: PlanCandidateFacts): PlanCandidate | null {
  if (facts.linkClosed) {
    return null;
  }
  return applyBeforeClose(facts) ?? followUp(facts) ?? askKnowSomeone(facts);
}
