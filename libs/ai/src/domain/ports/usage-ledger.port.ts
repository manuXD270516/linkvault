import type { DegradedReason } from '../ai-result';
import type { AiLedgerTask } from '../task';

// Ledger de uso de IA (design-v0.2 §4, D9 de ai-gateway-core). Nunca guarda input, salida ni prompt.

/** Única lista de outcomes: el schema del ledger la usa como `enum` (ai-usage-consent-reason). */
export const USAGE_OUTCOMES = [
  'success',
  'schema_error',
  'provider_error',
  'quota',
  'degraded',
] as const;

export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

export interface UsageRecord {
  userId?: string;
  /** Tarea LLM o `embed` (ADR-036). */
  task: AiLedgerTask;
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
