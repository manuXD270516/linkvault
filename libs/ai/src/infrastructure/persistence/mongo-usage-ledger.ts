import type { Connection, Model } from 'mongoose';
import type { AiTaskName } from '../../domain/task';
import type {
  UsageLedger,
  UsageRecord,
} from '../../domain/ports/usage-ledger.port';
import {
  AI_USAGE_MODEL_NAME,
  aiUsageSchema,
  type AiUsageDocument,
} from './ai-usage.schema';

// Ledger de uso en MongoDB (D9 de ai-gateway-core, ADR-018 §10) sobre la conexión Mongoose de la app
// (`getConnectionToken()`). `record` puede rechazar: `runTask` no la espera y captura el error hacia `AiLogger`.
// También cuenta ejecuciones exitosas para `ConfigQuotaPolicy`, sobre el mismo modelo e índice.

export interface SuccessCountQuery {
  userId: string;
  task: AiTaskName;
  since: Date;
  /** Límite de ejecución en el servidor; no acota la selección de servidor del driver. */
  maxTimeMS: number;
}

export interface SuccessCounter {
  countSuccessesSince(query: SuccessCountQuery): Promise<number>;
}

export class MongoUsageLedger implements UsageLedger, SuccessCounter {
  private readonly model: Model<AiUsageDocument>;

  constructor(connection: Connection) {
    this.model =
      (connection.models[AI_USAGE_MODEL_NAME] as
        Model<AiUsageDocument> | undefined) ??
      connection.model<AiUsageDocument>(AI_USAGE_MODEL_NAME, aiUsageSchema);
  }

  async record(entry: UsageRecord): Promise<void> {
    // Lista cerrada de campos: nada que no sea una métrica llega al documento aunque el objeto traiga más.
    const document: AiUsageDocument = {
      ...(entry.userId !== undefined ? { userId: entry.userId } : {}),
      task: entry.task,
      providerId: entry.providerId,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      estCost: entry.estCost,
      latencyMs: entry.latencyMs,
      outcome: entry.outcome,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      promptVersion: entry.promptVersion,
      key: entry.key,
      at: entry.at,
    };
    await this.model.create(document);
  }

  countSuccessesSince(query: SuccessCountQuery): Promise<number> {
    return this.model
      .countDocuments({
        userId: query.userId,
        task: query.task,
        outcome: 'success',
        at: { $gte: query.since },
      })
      .maxTimeMS(query.maxTimeMS)
      .exec();
  }
}
