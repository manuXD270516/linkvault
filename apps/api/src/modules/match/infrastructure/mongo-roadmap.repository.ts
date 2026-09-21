import { roadmapRequestedEvent } from '@linkvault/shared';
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
  ClaimGeneratingInput,
  ClaimResult,
  RoadmapRepository,
} from '../application/ports/roadmap-repository.port';
import {
  createGeneratingRoadmap,
  type StudyRoadmap,
} from '../domain/roadmap';
import {
  ROADMAP_MODEL_NAME,
  roadmapSchema,
  toAnalysisObjectId,
  toRoadmapObjectId,
  toUserObjectId,
  type RoadmapDocument,
} from './roadmap.schemas';

// Adaptador Mongo de ROADMAP_REPOSITORY (study-roadmap): claim + outbox en la misma tx; unique analysisId.

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoRoadmapRepository implements RoadmapRepository {
  private readonly roadmaps: Model<RoadmapDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {
    this.roadmaps = modelOf(connection, ROADMAP_MODEL_NAME, roadmapSchema);
  }

  nextId(): string {
    return new Types.ObjectId().toHexString();
  }

  async claimGenerating(input: ClaimGeneratingInput): Promise<ClaimResult> {
    const id = toRoadmapObjectId(input.id);
    const analysisId = toAnalysisObjectId(input.analysisId);
    const userId = toUserObjectId(input.userId);
    if (id === null || analysisId === null || userId === null) {
      throw new Error('Claiming a roadmap needs well formed ids');
    }
    const draft = createGeneratingRoadmap(input);

    try {
      return await this.withTransaction(async (session) => {
        const [created] = await this.roadmaps.create(
          [
            {
              _id: id,
              analysisId,
              userId,
              status: draft.status,
              createdAt: draft.createdAt,
              updatedAt: draft.updatedAt,
            },
          ],
          { session },
        );
        if (created === undefined) {
          throw new Error('The roadmap insert returned no document');
        }
        await this.outbox.append(
          roadmapRequestedEvent({
            analysisId: draft.analysisId,
            userId: draft.userId,
          }),
          session,
        );
        return { outcome: 'claimed', roadmap: toEntity(created.toObject()) };
      });
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      const existing = await this.findByAnalysisId(input.analysisId);
      if (existing === null) {
        throw error;
      }
      return { outcome: 'exists', roadmap: existing };
    }
  }

  async findByAnalysisId(analysisId: string): Promise<StudyRoadmap | null> {
    const id = toAnalysisObjectId(analysisId);
    if (id === null) {
      return null;
    }
    const document = await this.roadmaps
      .findOne({ analysisId: id })
      .lean()
      .exec();
    return document === null ? null : toEntity(document);
  }

  async removeByAnalysisIds(
    analysisIds: readonly string[],
    session: TransactionSession,
  ): Promise<number> {
    if (analysisIds.length === 0) {
      return 0;
    }
    const ids = analysisIds
      .map((aid) => toAnalysisObjectId(aid))
      .filter((oid): oid is Types.ObjectId => oid !== null);
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.roadmaps
      .deleteMany({ analysisId: { $in: ids } })
      .session(session as ClientSession)
      .exec();
    return result.deletedCount;
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

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === DUPLICATE_KEY
  );
}

function toEntity(doc: RoadmapDocument): StudyRoadmap {
  return {
    id: doc._id.toHexString(),
    analysisId: doc.analysisId.toHexString(),
    userId: doc.userId.toHexString(),
    status: doc.status,
    ...(doc.items === undefined ? {} : { items: doc.items }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
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
