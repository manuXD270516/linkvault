import type { AiTaskName } from '../task';

// Cuotas diarias por usuario y tarea (D9 de ai-gateway-core, ADR-018 §9; retryAt de cv-match-suggestions). Solo tipos.

/** Decisión de cuota: al denegar, cuándo vuelve a permitir (instante absoluto). */
export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; retryAt: Date };

export interface QuotaPolicy {
  /**
   * Si el usuario puede ejecutar la tarea. Falla abierta si no puede contar.
   * Cuando deniega, `retryAt` es el instante en que la ejecución contada más antigua sale de la ventana.
   */
  allows(userId: string, task: AiTaskName): Promise<QuotaDecision>;
}
