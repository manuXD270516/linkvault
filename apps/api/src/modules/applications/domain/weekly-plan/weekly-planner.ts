import type { WeeklyPlanInput, WeeklyPlanOutcome } from './weekly-plan';

/**
 * Puerto del planificador (D1). Asíncrono para que el planificador LLM del corte siguiente entre sin cambiar a quien
 * llama; `RuleBasedPlanner` resuelve sin E/S.
 */
export interface WeeklyPlanner {
  plan(input: WeeklyPlanInput): Promise<WeeklyPlanOutcome>;
}
