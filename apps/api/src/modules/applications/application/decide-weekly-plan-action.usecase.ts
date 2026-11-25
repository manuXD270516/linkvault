import type {
  WeeklyPlanDecisionRequest,
  WeeklyPlanResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { WeeklyPlanActionNotFound } from '../domain/errors';
import { GetWeeklyPlan } from './get-weekly-plan.usecase';
import { APPLICATIONS_CLOCK, type Clock } from './ports/clock.port';
import {
  WEEKLY_PLAN_DECISION_REPOSITORY,
  type WeeklyPlanDecisionRepository,
} from './ports/weekly-plan-decision-repository.port';

/**
 * `POST /api/applications/weekly-plan/decisions` (D5 de weekly-plan): recalcula las candidatas elegibles, valida contra
 * ellas el `candidateId` **antes de escribir** y guarda la decisión con la última escritura ganando. Responde el plan
 * recalculado. Nunca toca `applications` ni `application_events`. Un id inventado, ajeno, mal formado o que ya no aplica
 * es el mismo `WeeklyPlanActionNotFound`.
 */
@Injectable()
export class DecideWeeklyPlanAction {
  constructor(
    private readonly plan: GetWeeklyPlan,
    @Inject(WEEKLY_PLAN_DECISION_REPOSITORY)
    private readonly decisions: WeeklyPlanDecisionRepository,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    request: WeeklyPlanDecisionRequest,
  ): Promise<WeeklyPlanResponse> {
    const current = await this.plan.evaluate(userId);
    if (!current.eligibleCandidateIds.has(request.candidateId)) {
      throw new WeeklyPlanActionNotFound();
    }
    await this.decisions.upsert(userId, {
      candidateId: request.candidateId,
      weekKey: current.response.weekKey,
      decision: request.decision,
      decidedAt: this.clock.now(),
    });
    return await this.plan.execute(userId);
  }
}
