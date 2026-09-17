import type { AiTaskName } from '../task';

// Cuotas diarias por usuario y tarea (D9 de ai-gateway-core, ADR-018 §9). Solo tipos.

export interface QuotaPolicy {
  /** `true` si el usuario puede ejecutar la tarea; falla abierta si no puede contar. */
  allows(userId: string, task: AiTaskName): Promise<boolean>;
}
