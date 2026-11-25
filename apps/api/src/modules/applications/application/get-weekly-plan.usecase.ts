import type { WeeklyPlanAction, WeeklyPlanResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type {
  PlanCandidate,
  PlanDecisionFact,
} from '../domain/weekly-plan/weekly-plan';
import {
  GatherWeeklyPlanCandidates,
  type GatheredWeeklyPlan,
} from './gather-weekly-plan-candidates';
import { APPLICATIONS_CLOCK, type Clock } from './ports/clock.port';
import {
  WEEKLY_PLAN_DECISION_REPOSITORY,
  type StoredWeeklyPlanDecision,
  type WeeklyPlanDecisionRepository,
} from './ports/weekly-plan-decision-repository.port';
import { WEEKLY_PLANNER, type WeeklyPlanner } from './ports/weekly-planner.port';

/** Plan calculado y los ids reales de todas las candidatas elegibles de ese momento (antes de ocultar y del tope). */
export interface EvaluatedWeeklyPlan {
  readonly response: WeeklyPlanResponse;
  readonly eligibleCandidateIds: ReadonlySet<string>;
}

/**
 * `GET /api/applications/weekly-plan` (D1 de weekly-plan): recolecta candidatas (solo lecturas), lee las decisiones
 * vigentes, llama al planificador y traduce el resultado de vuelta a ids reales. **No escribe nada.**
 */
@Injectable()
export class GetWeeklyPlan {
  constructor(
    private readonly gather: GatherWeeklyPlanCandidates,
    @Inject(WEEKLY_PLAN_DECISION_REPOSITORY)
    private readonly decisions: WeeklyPlanDecisionRepository,
    @Inject(WEEKLY_PLANNER) private readonly planner: WeeklyPlanner,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string): Promise<WeeklyPlanResponse> {
    return (await this.evaluate(userId)).response;
  }

  /** Como `execute`, y además las candidatas elegibles: contra ellas valida `DecideWeeklyPlanAction` (D5). */
  async evaluate(userId: string): Promise<EvaluatedWeeklyPlan> {
    const now = this.clock.now();
    const [gathered, stored] = await Promise.all([
      this.gather.execute(userId, now),
      this.decisions.listActive(userId, now),
    ]);

    const outcome = await this.planner.plan({
      today: gathered.today,
      weekKey: gathered.weekKey,
      candidates: gathered.candidates,
      decisions: canonicalDecisions(stored, gathered),
    });

    return {
      response: {
        weekKey: gathered.weekKey,
        planner: outcome.planner,
        actions: outcome.actions.flatMap((candidate) => {
          const action = actionOf(candidate, gathered);
          return action === null ? [] : [action];
        }),
        doneThisWeek: stored.filter(
          (decision) =>
            decision.decision === 'done' &&
            decision.weekKey === gathered.weekKey,
        ).length,
      },
      eligibleCandidateIds: new Set(
        outcome.eligible.flatMap((candidate) => {
          const real = realCandidateId(candidate, gathered);
          return real === null ? [] : [real];
        }),
      ),
    };
  }
}

function realCandidateId(
  candidate: PlanCandidate,
  gathered: GatheredWeeklyPlan,
): string | null {
  const found = gathered.byKey.get(candidate.key);
  return found === undefined
    ? null
    : `${candidate.rule}:${found.application.id}`;
}

/** De `<regla>:<applicationId>` a `<regla>:<clave>`; una decisión de una postulación que ya no está en el universo se descarta. */
function canonicalDecisions(
  stored: readonly StoredWeeklyPlanDecision[],
  gathered: GatheredWeeklyPlan,
): PlanDecisionFact[] {
  const keyOf = new Map<string, string>();
  for (const [key, item] of gathered.byKey) {
    keyOf.set(item.application.id, key);
  }
  return stored.flatMap((decision) => {
    const separator = decision.candidateId.indexOf(':');
    if (separator < 0) {
      return [];
    }
    const key = keyOf.get(decision.candidateId.slice(separator + 1));
    if (key === undefined) {
      return [];
    }
    return [
      {
        candidateId: `${decision.candidateId.slice(0, separator)}:${key}`,
        decision: decision.decision,
        weekKey: decision.weekKey,
      },
    ];
  });
}

function actionOf(
  candidate: PlanCandidate,
  gathered: GatheredWeeklyPlan,
): WeeklyPlanAction | null {
  const found = gathered.byKey.get(candidate.key);
  if (found === undefined) {
    return null;
  }
  const { application, link } = found;
  return {
    candidateId: `${candidate.rule}:${application.id}`,
    rule: candidate.rule,
    applicationId: application.id,
    linkId: application.linkId,
    link: {
      displayUrl: link.displayUrl,
      ...(link.title === undefined ? {} : { title: link.title }),
      ...(link.company === undefined ? {} : { company: link.company }),
    },
    reason: candidate.reason,
  };
}
