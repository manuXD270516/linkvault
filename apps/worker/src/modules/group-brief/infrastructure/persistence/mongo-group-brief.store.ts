import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import type { GroupBriefStore } from '../../application/ports/group-brief.ports';
import {
  GROUP_WEEKLY_BRIEFS_COLLECTION,
  type GroupWeeklyBriefDocument,
} from './group-weekly-brief.document';
import {
  GROUP_WEEKLY_BRIEF_MODEL_NAME,
  groupWeeklyBriefSchema,
} from './group-weekly-brief.schemas';

const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

function groupBriefModel(
  connection: Connection,
): Model<GroupWeeklyBriefDocument> {
  return (
    (connection.models[GROUP_WEEKLY_BRIEF_MODEL_NAME] as
      Model<GroupWeeklyBriefDocument> | undefined) ??
    connection.model<GroupWeeklyBriefDocument>(
      GROUP_WEEKLY_BRIEF_MODEL_NAME,
      groupWeeklyBriefSchema,
    )
  );
}

/**
 * Crea los índices de `group_weekly_briefs` y espera a que existan, también sobre una colección vacía (H3).
 * Si falla (N2) lo registra y devuelve `false`: el módulo queda sin cron ni tick y el arranque sigue.
 */
export async function ensureGroupBriefIndexes(
  connection: Connection,
  logger: Pick<Logger, 'error'> = new Logger('GroupBriefIndexes'),
): Promise<boolean> {
  try {
    await groupBriefModel(connection).init();
    return true;
  } catch (error: unknown) {
    logger.error(
      `Could not ensure ${GROUP_WEEKLY_BRIEFS_COLLECTION} indexes: ${
        error instanceof Error ? error.name : 'unknown'
      }`,
    );
    return false;
  }
}

/**
 * Store Mongo del brief (D1, D2): `replaceOne` con `upsert`; una clave duplicada (dos ticks a la vez creando el
 * mismo documento) se reintenta una vez sin `upsert`, cuando ya existe y `replaceOne` lo reemplaza en su sitio.
 */
@Injectable()
export class MongoGroupBriefStore implements GroupBriefStore {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async replace(document: GroupWeeklyBriefDocument): Promise<void> {
    const collection = this.connection.collection(
      GROUP_WEEKLY_BRIEFS_COLLECTION,
    );
    const filter = { groupId: document.groupId, weekKey: document.weekKey };
    try {
      await collection.replaceOne(filter, document, { upsert: true });
    } catch (error: unknown) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      await collection.replaceOne(filter, document);
    }
  }

  async clear(groupId: string, weekKey: string): Promise<void> {
    await this.connection
      .collection(GROUP_WEEKLY_BRIEFS_COLLECTION)
      .deleteOne({ groupId: new Types.ObjectId(groupId), weekKey });
  }
}
