import type { WeeklyPlanDecision } from '@linkvault/shared';

// Puerto de las decisiones sobre las acciones de «Tu semana» (D5 de weekly-plan). Colección propia: una decisión nunca
// toca `applications` ni `application_events`. Se inyecta con
// `{ provide: WEEKLY_PLAN_DECISION_REPOSITORY, useClass: MongoWeeklyPlanDecisionRepository }`. Solo tipos y el token.

export const WEEKLY_PLAN_DECISION_REPOSITORY = Symbol(
  'WEEKLY_PLAN_DECISION_REPOSITORY',
);

/** Decisión guardada. El `candidateId` es el real (`<regla>:<applicationId>`). */
export interface StoredWeeklyPlanDecision {
  readonly candidateId: string;
  readonly weekKey: string;
  readonly decision: WeeklyPlanDecision;
  readonly decidedAt: Date;
}

export interface WeeklyPlanDecisionRepository {
  /**
   * Guarda la decisión con clave `(userId, weekKey, candidateId)`: la última gana y queda un solo documento. Un `userId`
   * mal formado no escribe nada.
   */
  upsert(userId: string, decision: StoredWeeklyPlanDecision): Promise<void>;

  /**
   * Decisiones vigentes de la persona: las de `decidedAt >= now - 35 días`, medido con el reloj que se pasa y **sin**
   * depender del monitor TTL de Mongo, que borra con retraso (N2). Sin filtrar por semana: `dismissed` oculta durante
   * todo el plazo. Un `userId` mal formado devuelve una lista vacía.
   */
  listActive(userId: string, now: Date): Promise<StoredWeeklyPlanDecision[]>;
}
