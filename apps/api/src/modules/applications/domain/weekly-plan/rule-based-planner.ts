import { nextWeekKey, WEEKLY_PLAN_MAX_ACTIONS } from '@linkvault/shared';
import { evaluateRules, RULE_ORDER } from './rules';
import type {
  PlanCandidate,
  PlanDecisionFact,
  WeeklyPlanInput,
  WeeklyPlanOutcome,
} from './weekly-plan';
import type { WeeklyPlanner } from './weekly-planner';

/**
 * Planificador determinista (D1-D3, D5): una candidata por postulación, ocultas las que decidió la persona, y selección
 * por turnos —la primera de cada regla, en orden, hasta repetir— con tope `WEEKLY_PLAN_MAX_ACTIONS`. Sin E/S ni reloj.
 */
export class RuleBasedPlanner implements WeeklyPlanner {
  plan(input: WeeklyPlanInput): Promise<WeeklyPlanOutcome> {
    return Promise.resolve(planWeek(input));
  }
}

function planWeek(input: WeeklyPlanInput): WeeklyPlanOutcome {
  const eligible = input.candidates
    .map((facts) => evaluateRules(facts))
    .filter((c): c is PlanCandidate => c !== null);

  const hidden = hiddenCandidateIds(input);
  const queues = RULE_ORDER.map((rule) =>
    eligible
      .filter((c) => c.rule === rule && !hidden.has(c.candidateId))
      .sort(compareWithinRule),
  );

  const actions: PlanCandidate[] = [];
  let round = 0;
  while (actions.length < WEEKLY_PLAN_MAX_ACTIONS) {
    let tookAny = false;
    for (const queue of queues) {
      const next = queue[round];
      if (next !== undefined && actions.length < WEEKLY_PLAN_MAX_ACTIONS) {
        actions.push(next);
        tookAny = true;
      }
    }
    if (!tookAny) {
      break;
    }
    round += 1;
  }

  return {
    planner: 'rules',
    actions,
    eligible: [...eligible].sort(
      (a, b) =>
        RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
        compareWithinRule(a, b),
    ),
  };
}

/**
 * D5: `snoozed` oculta solo la semana de la decisión; `done`, esa y la siguiente; `dismissed`, mientras viva la decisión
 * (el repositorio ya descartó las de más de 35 días con el reloj de la aplicación).
 */
function hiddenCandidateIds(input: WeeklyPlanInput): Set<string> {
  const hidden = new Set<string>();
  for (const decision of input.decisions) {
    if (hides(decision, input.weekKey)) {
      hidden.add(decision.candidateId);
    }
  }
  return hidden;
}

function hides(decision: PlanDecisionFact, weekKey: string): boolean {
  switch (decision.decision) {
    case 'dismissed':
      return true;
    case 'done':
      return (
        decision.weekKey === weekKey ||
        nextWeekKey(decision.weekKey) === weekKey
      );
    case 'snoozed':
      return decision.weekKey === weekKey;
  }
}

/** `closing_soon` por días asc y luego `high_fit` por score desc; `quiet` por días desc; `know_someone` por conteo desc. */
function rank(c: PlanCandidate): number[] {
  switch (c.reason.kind) {
    case 'closing_soon':
      return [0, c.reason.daysLeft];
    case 'high_fit':
      return [1, -c.reason.score];
    case 'quiet':
      return [0, -c.reason.daysQuiet];
    case 'know_someone':
      return [0, -c.reason.count];
  }
}

function compareWithinRule(a: PlanCandidate, b: PlanCandidate): number {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i += 1) {
    const diff = (ra[i] ?? 0) - (rb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  // La clave se ordena igual que el `applicationId` (D2): desempate final.
  if (a.key === b.key) {
    return 0;
  }
  return a.key < b.key ? -1 : 1;
}
