import type {
  WeeklyPlanDecision,
  WeeklyPlanReason,
  WeeklyPlanRule,
} from '@linkvault/shared';
import type { ApplicationStatus } from '../application-status';

// Tipos canónicos del plan semanal (D1 y D12 de weekly-plan). Sin `ObjectId` ni `Date`: días relativos, `today` como
// `YYYY-MM-DD` y una clave opaca por candidata. El caso de uso traduce de ids reales a esa clave y de vuelta; así el mismo
// objeto sirve mañana de entrada al planificador LLM con ids sintéticos y la clave de `replay` es estable.

/** Hechos de una postulación abierta cuyo link existe. Nada de otras personas salvo el conteo. */
export interface PlanCandidateFacts {
  /** Clave opaca. Se ordena igual que el `applicationId` al que representa (desempate de D2). */
  readonly key: string;
  readonly status: ApplicationStatus;
  /** `true` si el link tiene `closedAt` (ADR-037): fuera del plan. */
  readonly linkClosed: boolean;
  /** Días enteros desde `statusChangedAt` hasta ahora. */
  readonly daysQuiet: number;
  /** `appliedAt` de la postulación (ISO), solo para el borrador de seguimiento. */
  readonly appliedAt?: string;
  /** `preview.expiresAt` (`YYYY-MM-DD`); ausente si el link no lo trae. */
  readonly expiresAt?: string;
  /** Días enteros de hoy (UTC) a `expiresAt`; negativo si ya pasó. Presente si y solo si hay `expiresAt`. */
  readonly daysUntilExpiry?: number;
  /** Último análisis `done` de encaje, solo para `saved` e `interested`. */
  readonly fit?: { readonly score: number; readonly degraded: boolean };
  /** Marcas «conozco a alguien» de otras personas en el grupo elegido; solo conteo. Ausente si 0. */
  readonly knowSomeone?: { readonly count: number; readonly groupId: string };
}

/** Decisión ya guardada y vigente. `candidateId` es `<regla>:<clave>`. */
export interface PlanDecisionFact {
  readonly candidateId: string;
  readonly decision: WeeklyPlanDecision;
  /** Semana ISO UTC en la que se decidió. */
  readonly weekKey: string;
}

export interface WeeklyPlanInput {
  /** Fecha UTC de hoy, `YYYY-MM-DD`. */
  readonly today: string;
  /** Semana ISO UTC en curso, `YYYY-Www`. */
  readonly weekKey: string;
  readonly candidates: readonly PlanCandidateFacts[];
  /** Decisiones vigentes (el reloj ya descartó las de más de 35 días). */
  readonly decisions: readonly PlanDecisionFact[];
}

/** Una candidata elegible: la primera regla que cumple una postulación. */
export interface PlanCandidate {
  /** `<regla>:<clave>`. */
  readonly candidateId: string;
  readonly rule: WeeklyPlanRule;
  readonly key: string;
  readonly reason: WeeklyPlanReason;
}

export interface WeeklyPlanOutcome {
  readonly planner: 'rules';
  /** Hasta `WEEKLY_PLAN_MAX_ACTIONS`, en orden de presentación. */
  readonly actions: readonly PlanCandidate[];
  /** Todas las candidatas elegibles, antes de ocultar y del tope: contra ellas se valida una decisión (D5). */
  readonly eligible: readonly PlanCandidate[];
}
