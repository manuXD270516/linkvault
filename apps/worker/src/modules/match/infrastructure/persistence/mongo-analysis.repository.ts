import {
  isMatchStepRegression,
  type MatchStep,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Types,
  type Connection,
  type Model,
  type Schema as MongooseSchema,
  type UpdateQuery,
} from 'mongoose';
import { APP_CONFIG } from '../../../../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../../../../infrastructure/config/worker-config.schema';
import type { AnalysisRepository } from '../../application/ports/analysis-repository.port';
import { MATCH_CLOCK, type Clock } from '../../application/ports/clock.port';
import type {
  CompleteAnalysisInput,
  FailAnalysisInput,
  MatchAnalysis,
} from '../../domain/analysis';
import { earliestRequestedAtStillRunning } from '../../domain/expiry';
import {
  ANALYSIS_MODEL_NAME,
  analysisSchema,
  toAnalysisObjectId,
  type AnalysisDocument,
} from './analysis.schemas';

// Adaptador Mongo del worker (tareas 13.4 y 13.5, ADR-030 §7 y §13).
//
// Toda escritura es `updateOne` **sin upsert**, condicionada a `status: 'running'` y a que el plazo
// (`MATCH_ANALYSIS_MAX_AGE_MS`) no haya vencido. Un resultado tardío no sobrescribe lo leído como avería ni
// resucita un análisis purgado con su fragmento de CV. Si no hay documento, no hace nada y no lanza.

@Injectable()
export class MongoAnalysisRepository implements AnalysisRepository {
  private readonly analyses: Model<AnalysisDocument>;
  private readonly maxAgeMs: number;

  constructor(
    @Inject(getConnectionToken()) connection: Connection,
    @Inject(MATCH_CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) config: WorkerConfig,
  ) {
    this.analyses = modelOf(connection, ANALYSIS_MODEL_NAME, analysisSchema);
    this.maxAgeMs = config.MATCH_ANALYSIS_MAX_AGE_MS;
  }

  async findById(analysisId: string): Promise<MatchAnalysis | null> {
    const id = toAnalysisObjectId(analysisId);
    if (id === null) {
      return null;
    }
    const document = await this.analyses.findById(id).lean().exec();
    return document === null ? null : toEntity(document);
  }

  async complete(
    analysisId: string,
    input: CompleteAnalysisInput,
  ): Promise<boolean> {
    const id = toAnalysisObjectId(analysisId);
    if (id === null) {
      return false;
    }

    const set: Record<string, unknown> = {
      status: 'done',
      step: input.step,
      report: input.report,
      promptVersion: input.promptVersion,
      previewVersion: input.previewVersion,
      degraded: input.degraded,
      consentRequired: input.consentRequired,
      wentExternal: input.wentExternal,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs,
    };
    if (input.provider !== undefined) {
      set['provider'] = input.provider;
    }
    if (input.model !== undefined) {
      set['model'] = input.model;
    }
    if (input.degradedReason !== undefined) {
      set['degradedReason'] = input.degradedReason;
    }
    if (input.aiQuotaRetryAt !== undefined) {
      set['aiQuotaRetryAt'] = input.aiQuotaRetryAt;
    }

    const unset: Record<string, 1> = { failureCode: 1 };
    if (input.degradedReason === undefined) {
      unset['degradedReason'] = 1;
    }
    if (input.aiQuotaRetryAt === undefined) {
      unset['aiQuotaRetryAt'] = 1;
    }

    const update: UpdateQuery<AnalysisDocument> = { $set: set, $unset: unset };
    const result = await this.analyses
      .updateOne(this.runningFilter(id), update, { upsert: false })
      .exec();
    return result.matchedCount > 0;
  }

  async fail(analysisId: string, input: FailAnalysisInput): Promise<boolean> {
    const id = toAnalysisObjectId(analysisId);
    if (id === null) {
      return false;
    }
    const result = await this.analyses
      .updateOne(
        this.runningFilter(id),
        {
          $set: {
            status: 'failed',
            step: 'failed',
            failureCode: input.failureCode,
            finishedAt: input.finishedAt,
            durationMs: input.durationMs,
          },
          $unset: {
            report: 1,
            degraded: 1,
            degradedReason: 1,
            aiQuotaRetryAt: 1,
            provider: 1,
            model: 1,
          },
        },
        { upsert: false },
      )
      .exec();
    return result.matchedCount > 0;
  }

  async recordStep(analysisId: string, step: MatchStep): Promise<boolean> {
    const id = toAnalysisObjectId(analysisId);
    if (id === null) {
      return false;
    }

    const current = await this.analyses
      .findOne(this.runningFilter(id))
      .lean()
      .exec();
    if (current === null) {
      return false;
    }
    if (isMatchStepRegression(current.step, step)) {
      return false;
    }

    // Condicionado al paso leído: otra escritura concurrente que avancé más gana; nosotros no retrocedemos.
    const result = await this.analyses
      .updateOne(
        { ...this.runningFilter(id), step: current.step },
        { $set: { step } },
        { upsert: false },
      )
      .exec();
    return result.matchedCount > 0;
  }

  private runningFilter(id: Types.ObjectId): Record<string, unknown> {
    return {
      _id: id,
      status: 'running',
      requestedAt: {
        $gte: earliestRequestedAtStillRunning(this.maxAgeMs, this.clock.now()),
      },
    };
  }
}

function modelOf<T>(
  connection: Connection,
  name: string,
  schema: MongooseSchema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}

function toEntity(
  document: AnalysisDocument | (AnalysisDocument & { _id: Types.ObjectId }),
): MatchAnalysis {
  return {
    id: document._id.toHexString(),
    userId: document.userId.toHexString(),
    linkId: document.linkId.toHexString(),
    cvId: document.cvId.toHexString(),
    status: document.status,
    step: document.step,
    previewVersion: document.previewVersion,
    promptVersion: document.promptVersion,
    ...(document.provider === undefined ? {} : { provider: document.provider }),
    ...(document.model === undefined ? {} : { model: document.model }),
    ...(document.report === undefined ? {} : { report: document.report }),
    ...(document.degraded === undefined ? {} : { degraded: document.degraded }),
    ...(document.degradedReason === undefined
      ? {}
      : { degradedReason: document.degradedReason }),
    ...(document.failureCode === undefined
      ? {}
      : { failureCode: document.failureCode }),
    ...(document.aiQuotaRetryAt === undefined
      ? {}
      : { aiQuotaRetryAt: document.aiQuotaRetryAt }),
    consentRequired: document.consentRequired,
    wentExternal: document.wentExternal,
    requestedAt: document.requestedAt,
    ...(document.finishedAt === undefined
      ? {}
      : { finishedAt: document.finishedAt }),
    ...(document.durationMs === undefined
      ? {}
      : { durationMs: document.durationMs }),
  };
}
