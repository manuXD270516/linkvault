import type { DegradedReason } from '../ai-result';
import type { AiTaskName } from '../task';

// Ledger de uso de IA (design-v0.2 §4, D9 de ai-gateway-core). Solo tipos. Nunca guarda input, salida ni prompt.

export type UsageOutcome =
  'success' | 'schema_error' | 'provider_error' | 'quota' | 'degraded';

export interface UsageRecord {
  userId?: string;
  task: AiTaskName;
  /** `null` en registros `quota` y `degraded`. */
  providerId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  estCost: number;
  latencyMs: number;
  outcome: UsageOutcome;
  /** Solo en registros `degraded`. */
  reason?: DegradedReason;
  promptVersion: string;
  /** Clave de ejecución (hash); nunca el contenido. */
  key: string;
  at: Date;
}

export interface UsageLedger {
  /** `runTask` no espera esta promesa (ADR-018 §10). */
  record(entry: UsageRecord): Promise<void>;
}
