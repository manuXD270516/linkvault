import { z } from 'zod';
import { isoWeekKeySchema } from '../time/iso-week';

// Contrato HTTP de «Tu semana» (design D8 de weekly-plan, ADR-068). El texto del motivo no viaja: lo arma el SPA desde
// `reason` con i18n. `planner` es un enum para que el corte LLM añada `'llm'` sin romper a los clientes.

/** Tope de acciones que muestra el plan (D3). */
export const WEEKLY_PLAN_MAX_ACTIONS = 3;
/** Una oferta guardada cuyo `expiresAt` cae dentro de estos días (UTC) entra por `apply_before_close` (D2). */
export const WEEKLY_PLAN_CLOSING_SOON_DAYS = 7;
/** Encaje mínimo (análisis no degradado) para sugerir postular sin fecha de cierre (D2, C7). */
export const WEEKLY_PLAN_HIGH_FIT_SCORE = 75;
/** Postulaciones que se leen como máximo al armar el plan (D2, C6). */
export const WEEKLY_PLAN_SCAN_MAX = 200;
/** Retención de las decisiones y vigencia de «Ocultar sugerencia» (D5). */
export const WEEKLY_PLAN_DECISION_TTL_DAYS = 35;

export const weeklyPlanRuleSchema = z.enum([
  'apply_before_close',
  'follow_up',
  'ask_know_someone',
]);
export type WeeklyPlanRule = z.infer<typeof weeklyPlanRuleSchema>;

export const weeklyPlanDecisionSchema = z.enum(['done', 'dismissed', 'snoozed']);
export type WeeklyPlanDecision = z.infer<typeof weeklyPlanDecisionSchema>;

export const weeklyPlanWeekKeySchema = isoWeekKeySchema;

/** Solo se acota: el formato `<regla>:<applicationId>` lo juzga el dominio (404 uniforme). */
export const weeklyPlanCandidateIdSchema = z.string().trim().min(1).max(96);

export const weeklyPlanReasonSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('closing_soon'),
    expiresAt: z.iso.date(),
    daysLeft: z.number().int().min(0).max(WEEKLY_PLAN_CLOSING_SOON_DAYS),
  }),
  z.strictObject({
    kind: z.literal('high_fit'),
    score: z.number().int().min(0).max(100),
  }),
  z.strictObject({
    kind: z.literal('quiet'),
    daysQuiet: z.number().int().min(10),
    status: z.enum(['applied', 'in_process']),
    appliedAt: z.iso.datetime().optional(),
  }),
  z.strictObject({
    kind: z.literal('know_someone'),
    count: z.number().int().min(1),
    groupId: z.string().min(1),
  }),
]);
export type WeeklyPlanReason = z.infer<typeof weeklyPlanReasonSchema>;

export const weeklyPlanActionSchema = z.strictObject({
  candidateId: weeklyPlanCandidateIdSchema,
  rule: weeklyPlanRuleSchema,
  applicationId: z.string().min(1),
  linkId: z.string().min(1),
  link: z.strictObject({
    displayUrl: z.string().min(1),
    title: z.string().optional(),
    company: z.string().optional(),
  }),
  reason: weeklyPlanReasonSchema,
});
export type WeeklyPlanAction = z.infer<typeof weeklyPlanActionSchema>;

export const weeklyPlanResponseSchema = z.strictObject({
  weekKey: weeklyPlanWeekKeySchema,
  planner: z.enum(['rules']),
  actions: z.array(weeklyPlanActionSchema).max(WEEKLY_PLAN_MAX_ACTIONS),
  doneThisWeek: z.number().int().nonnegative(),
});
export type WeeklyPlanResponse = z.infer<typeof weeklyPlanResponseSchema>;

export const weeklyPlanDecisionRequestSchema = z.strictObject({
  candidateId: weeklyPlanCandidateIdSchema,
  decision: weeklyPlanDecisionSchema,
});
export type WeeklyPlanDecisionRequest = z.infer<
  typeof weeklyPlanDecisionRequestSchema
>;
