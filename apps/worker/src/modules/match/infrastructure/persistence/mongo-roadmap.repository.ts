import type { RoadmapItem } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Types,
  type Connection,
  type Model,
  type Schema as MongooseSchema,
} from 'mongoose';
import type {
  ClaimOutcome,
  RoadmapRepository,
} from '../../application/ports/roadmap-repository.port';
import { createGeneratingRoadmap, type StudyRoadmap } from '../../domain/roadmap';
import {
  ROADMAP_MODEL_NAME,
  roadmapSchema,
  toObjectId,
  type RoadmapDocument,
} from './roadmap.schemas';

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoRoadmapRepository implements RoadmapRepository {
  private readonly roadmaps: Model<RoadmapDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.roadmaps = modelOf(connection, ROADMAP_MODEL_NAME, roadmapSchema);
  }

  nextId(): string {
    return new Types.ObjectId().toHexString();
  }

  async findByAnalysisId(analysisId: string): Promise<StudyRoadmap | null> {
    const id = toObjectId(analysisId);
    if (id === null) {
      return null;
    }
    const document = await this.roadmaps
      .findOne({ analysisId: id })
      .lean()
      .exec();
    return document === null ? null : toEntity(document);
  }

  async claimOrGet(input: {
    readonly id: string;
    readonly analysisId: string;
    readonly userId: string;
    readonly createdAt: Date;
  }): Promise<ClaimOutcome> {
    const existing = await this.findByAnalysisId(input.analysisId);
    if (existing !== null) {
      if (existing.status === 'generating') {
        return { kind: 'already_generating', roadmap: existing };
      }
      return { kind: 'already_done' };
    }

    const id = toObjectId(input.id);
    const analysisId = toObjectId(input.analysisId);
    const userId = toObjectId(input.userId);
    if (id === null || analysisId === null || userId === null) {
      return { kind: 'lost' };
    }
    const draft = createGeneratingRoadmap(input);
    try {
      const [created] = await this.roadmaps.create([
        {
          _id: id,
          analysisId,
          userId,
          status: draft.status,
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
        },
      ]);
      if (created === undefined) {
        return { kind: 'lost' };
      }
      return { kind: 'won', roadmap: toEntity(created.toObject()) };
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      return { kind: 'lost' };
    }
  }

  async tryBeginBuild(analysisId: string, startedAt: Date): Promise<boolean> {
    const id = toObjectId(analysisId);
    if (id === null) {
      return false;
    }
    const result = await this.roadmaps
      .updateOne(
        {
          analysisId: id,
          status: 'generating',
          buildStartedAt: { $exists: false },
        },
        { $set: { buildStartedAt: startedAt, updatedAt: startedAt } },
        { upsert: false },
      )
      .exec();
    return result.matchedCount > 0;
  }

  async markReady(
    analysisId: string,
    items: readonly RoadmapItem[],
    updatedAt: Date,
  ): Promise<boolean> {
    const id = toObjectId(analysisId);
    if (id === null) {
      return false;
    }
    const result = await this.roadmaps
      .updateOne(
        { analysisId: id, status: 'generating' },
        {
          $set: {
            status: 'ready',
            items: [...items],
            updatedAt,
          },
        },
        { upsert: false },
      )
      .exec();
    return result.matchedCount > 0;
  }

  async markFailed(analysisId: string, updatedAt: Date): Promise<boolean> {
    const id = toObjectId(analysisId);
    if (id === null) {
      return false;
    }
    const result = await this.roadmaps
      .updateOne(
        { analysisId: id, status: 'generating' },
        {
          $set: { status: 'failed', updatedAt },
          $unset: { items: 1 },
        },
        { upsert: false },
      )
      .exec();
    return result.matchedCount > 0;
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
