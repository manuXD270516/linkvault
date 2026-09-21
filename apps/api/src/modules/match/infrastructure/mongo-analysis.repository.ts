import { matchRequestedEvent } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Types,
  type ClientSession,
  type Connection,
  type Model,
  type Schema as MongooseSchema,
} from 'mongoose';
import { OUTBOX, type Outbox } from '../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import type {
  AnalysisFitScore,
  AnalysisRepository,
  CreateRunningAnalysisInput,
  QuotaCount,
  ReusableDegradedAnalysis,
} from '../application/ports/analysis-repository.port';
import {
  createRunningAnalysis,
  type MatchAnalysis,
} from '../domain/analysis';
import { readAnalysis } from '../domain/expiry';
import {
  AI_ANALYSES_COLLECTION,
  ANALYSIS_MODEL_NAME,
  analysisSchema,
  toAnalysisObjectId,
  toCvObjectId,
  toLinkObjectId,
  toUserObjectId,
  type AnalysisDocument,
} from './analysis.schemas';

// Adaptador Mongo de ANALYSIS_REPOSITORY (D2, D12-ter; ADR-030 §4, §7, §8) sobre la conexión Mongoose de la app.
//
// Tres cosas que este adaptador hace y ningún otro sitio puede hacer por él en la API:
//
// 1. **Escribir el documento y su evento en la misma transacción** (ADR-009). El caso de uso no ve la sesión.
// 2. **Derivar el vencimiento al leer** sin mutar: un `running` colgado aparece como `failed` en `findLatestResolved`.
// 3. **Contar la cuota del historial** en una sola consulta, sin contador aparte que reconciliar.

@Injectable()
export class MongoAnalysisRepository implements AnalysisRepository {
  private readonly analyses: Model<AnalysisDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {
    this.analyses = modelOf(connection, ANALYSIS_MODEL_NAME, analysisSchema);
  }

  nextId(): string {
    return new Types.ObjectId().toHexString();
  }

  async createRunning(
    input: CreateRunningAnalysisInput,
  ): Promise<MatchAnalysis> {
    const id = toAnalysisObjectId(input.id);
    const owner = toUserObjectId(input.userId);
    const link = toLinkObjectId(input.linkId);
    const cv = toCvObjectId(input.cvId);
    if (id === null || owner === null || link === null || cv === null) {
      throw new Error('Saving an analysis needs well formed ids');
    }
    const draft = createRunningAnalysis(input);

    return await this.withTransaction(async (session) => {
      const [created] = await this.analyses.create(
        [
          {
            _id: id,
            userId: owner,
            linkId: link,
            cvId: cv,
            status: draft.status,
            step: draft.step,
            previewVersion: draft.previewVersion,
            promptVersion: draft.promptVersion,
            consentRequired: draft.consentRequired,
            wentExternal: draft.wentExternal,
            requestedAt: draft.requestedAt,
          },
        ],
        { session },
      );
      if (created === undefined) {
        throw new Error('The analysis insert returned no document');
      }
      await this.outbox.append(
        matchRequestedEvent({
          analysisId: draft.id,
          userId: draft.userId,
          linkId: draft.linkId,
          cvId: draft.cvId,
        }),
        session,
      );
      return toEntity(created.toObject());
    });
  }

  async findLatestResolved(
    userId: string,
    linkId: string,
    maxAgeMs: number,
    now: Date,
  ): Promise<MatchAnalysis | null> {
    const owner = toUserObjectId(userId);
    const link = toLinkObjectId(linkId);
    if (owner === null || link === null) {
      return null;
    }

    const deadline = new Date(now.getTime() - maxAgeMs);
    const documents = await this.analyses
      .find({
        userId: owner,
        linkId: link,
        $or: [
          { status: { $in: ['done', 'failed'] } },
          { status: 'running', requestedAt: { $lt: deadline } },
        ],
      })
      .lean()
      .exec();

    if (documents.length === 0) {
      return null;
    }

    const viewed = documents
      .map((doc) => readAnalysis(toEntity(doc), maxAgeMs, now))
      .filter((a) => a.status === 'done' || a.status === 'failed');

    viewed.sort(
      (a, b) =>
        (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0),
    );
    return viewed[0] ?? null;
  }

  async findRunning(
    userId: string,
    linkId: string,
    maxAgeMs: number,
    now: Date,
  ): Promise<MatchAnalysis | null> {
    const owner = toUserObjectId(userId);
    const link = toLinkObjectId(linkId);
    if (owner === null || link === null) {
      return null;
    }

    // Dentro del plazo: requestedAt >= now - maxAgeMs (equivalente a now <= requestedAt + maxAgeMs).
    const earliestStillRunning = new Date(now.getTime() - maxAgeMs);
    const document = await this.analyses
      .findOne({
        userId: owner,
        linkId: link,
        status: 'running',
        requestedAt: { $gte: earliestStillRunning },
      })
      .sort({ requestedAt: -1 })
      .lean()
      .exec();

    return document === null ? null : toEntity(document);
  }

  async findReusable(
    userId: string,
    linkId: string,
    cvId: string,
    previewVersion: number,
    promptVersion: string,
  ): Promise<MatchAnalysis | null> {
    const owner = toUserObjectId(userId);
    const link = toLinkObjectId(linkId);
    const cv = toCvObjectId(cvId);
    if (owner === null || link === null || cv === null) {
      return null;
    }

    const document = await this.analyses
      .findOne({
        userId: owner,
        linkId: link,
        cvId: cv,
        status: 'done',
        degraded: { $ne: true },
        previewVersion,
        promptVersion,
      })
      .sort({ finishedAt: -1 })
      .lean()
      .exec();

    return document === null ? null : toEntity(document);
  }

  async findReusableDegraded(
    userId: string,
    linkId: string,
    cvId: string,
    previewVersion: number,
    promptVersion: string,
  ): Promise<ReusableDegradedAnalysis | null> {
    const owner = toUserObjectId(userId);
    const link = toLinkObjectId(linkId);
    const cv = toCvObjectId(cvId);
    if (owner === null || link === null || cv === null) {
      return null;
    }

    const document = await this.analyses
      .findOne({
        userId: owner,
        linkId: link,
        cvId: cv,
        status: 'done',
        degraded: true,
        previewVersion,
        promptVersion,
      })
      .sort({ finishedAt: -1 })
      .lean()
      .exec();

    if (document === null) {
      return null;
    }
    const analysis = toEntity(document);
    if (
      analysis.report === undefined ||
      analysis.degradedReason === undefined
    ) {
      return null;
    }
    return {
      analysis,
      degradedReason: analysis.degradedReason,
      ...(analysis.aiQuotaRetryAt === undefined
        ? {}
        : { aiQuotaRetryAt: analysis.aiQuotaRetryAt }),
      report: analysis.report,
    };
  }

  async countForQuota(
    userId: string,
    windowMs: number,
    maxAgeMs: number,
    now: Date,
  ): Promise<QuotaCount> {
    const owner = toUserObjectId(userId);
    if (owner === null) {
      return { count: 0 };
    }

    const windowStart = new Date(now.getTime() - windowMs);
    const earliestStillRunning = new Date(now.getTime() - maxAgeMs);

    const [row] = await this.analyses
      .aggregate<{
        count: number;
        oldestAt: Date;
        oldestKind: 'finished' | 'running';
      }>([
        {
          $match: {
            userId: owner,
            $or: [
              {
                status: 'done',
                degraded: { $ne: true },
                finishedAt: { $gte: windowStart },
              },
              {
                status: 'running',
                requestedAt: { $gte: earliestStillRunning },
              },
            ],
          },
        },
        {
          $addFields: {
            sortAt: {
              $cond: [
                { $eq: ['$status', 'running'] },
                '$requestedAt',
                '$finishedAt',
              ],
            },
            kind: {
              $cond: [
                { $eq: ['$status', 'running'] },
                'running',
                'finished',
              ],
            },
          },
        },
        { $sort: { sortAt: 1 } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            oldestAt: { $first: '$sortAt' },
            oldestKind: { $first: '$kind' },
          },
        },
      ])
      .exec();

    if (row === undefined || row.count === 0) {
      return { count: 0 };
    }

    return {
      count: row.count,
      oldest: { kind: row.oldestKind, at: new Date(row.oldestAt) },
    };
  }

  async removeByCv(
    userId: string,
    cvId: string,
    session: TransactionSession,
  ): Promise<number> {
    const owner = toUserObjectId(userId);
    const cv = toCvObjectId(cvId);
    if (owner === null || cv === null) {
      return 0;
    }
    const result = await this.analyses
      .deleteMany({ userId: owner, cvId: cv })
      .session(session as ClientSession)
      .exec();
    return result.deletedCount;
  }

  async countByCv(userId: string): Promise<ReadonlyMap<string, number>> {
    const owner = toUserObjectId(userId);
    const counts = new Map<string, number>();
    if (owner === null) {
      return counts;
    }

    const rows = await this.analyses
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { userId: owner } },
        { $group: { _id: '$cvId', count: { $sum: 1 } } },
      ])
      .exec();

    for (const row of rows) {
      counts.set(row._id.toHexString(), row.count);
    }
    return counts;
  }

  async findLatestDoneFitScores(
    userId: string,
    linkIds: readonly string[],
  ): Promise<ReadonlyMap<string, AnalysisFitScore>> {
    const scores = new Map<string, AnalysisFitScore>();
    if (linkIds.length === 0) {
      return scores;
    }
    const owner = toUserObjectId(userId);
    if (owner === null) {
      return scores;
    }
    const links = linkIds
      .map((id) => toLinkObjectId(id))
      .filter((id): id is Types.ObjectId => id !== null);
    if (links.length === 0) {
      return scores;
    }

    const rows = await this.analyses
      .aggregate<{
        _id: Types.ObjectId;
        score: number;
        degraded: boolean | null;
      }>([
        {
          $match: {
            userId: owner,
            linkId: { $in: links },
            status: 'done',
            'report.score': { $type: 'number' },
          },
        },
        { $sort: { finishedAt: -1 } },
        {
          $group: {
            _id: '$linkId',
            score: { $first: '$report.score' },
            degraded: { $first: '$degraded' },
          },
        },
      ])
      .exec();

    for (const row of rows) {
      scores.set(row._id.toHexString(), {
        score: row.score,
        degraded: row.degraded === true,
      });
    }
    return scores;
  }

  private async withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
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

export { AI_ANALYSES_COLLECTION };
