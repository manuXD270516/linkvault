import { Inject, Injectable, Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { OUTBOX, type Outbox } from '../../../infrastructure/outbox/outbox.port';
import {
  searchContentHash,
  searchUpsertEvent,
  type SearchDocType,
  type SearchUpsertReason,
} from '@linkvault/shared';

/**
 * Backfill / re-embed (D5 / C8): encola SearchUpsert desde Mongo con rate SEARCH_BACKFILL_RATE.
 * No llama a Meili; el worker indexa. Dry-run solo cuenta candidatos.
 */
@Injectable()
export class BackfillSearch {
  private readonly logger = new Logger(BackfillSearch.name);

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
  ) {}

  async execute(options: BackfillSearchOptions): Promise<BackfillSearchReport> {
    if (!this.config.FEATURE_SEARCH) {
      this.logger.warn('Backfill skipped: FEATURE_SEARCH=false');
      return { found: 0, enqueued: 0 };
    }
    const candidates = await this.collect(options);
    if (options.dryRun) {
      return { found: candidates.length, enqueued: 0 };
    }
    let enqueued = 0;
    const delayMs = Math.ceil(1000 / this.config.SEARCH_BACKFILL_RATE);
    for (const candidate of candidates) {
      await this.enqueue(candidate);
      enqueued += 1;
      if (delayMs > 0 && enqueued < candidates.length) {
        await sleep(delayMs);
      }
    }
    this.logger.log(
      `Backfill enqueued ${enqueued} of ${candidates.length} search upserts`,
    );
    return { found: candidates.length, enqueued };
  }

  private async collect(
    options: BackfillSearchOptions,
  ): Promise<BackfillCandidate[]> {
    const limit = options.limit;
    const out: BackfillCandidate[] = [];
    const reason: SearchUpsertReason = options.reembed ? 'reembed' : 'backfill';

    if (include(options.docType, 'job_preview')) {
      const rows = await this.connection
        .collection('job_links')
        .find(
          options.userId === undefined
            ? {}
            : { createdBy: options.userId },
          { projection: { _id: 1 }, limit },
        )
        .toArray();
      for (const row of rows) {
        out.push({
          docType: 'job_preview',
          aggregateId: String(row._id),
          reason,
          fingerprint: `backfill:job_preview:${String(row._id)}:${Date.now()}`,
        });
        if (out.length >= limit) return out;
      }
    }
    if (include(options.docType, 'application')) {
      const filter =
        options.userId === undefined ? {} : { userId: options.userId };
      const rows = await this.connection
        .collection('applications')
        .find(filter, { projection: { _id: 1 }, limit: limit - out.length })
        .toArray();
      for (const row of rows) {
        out.push({
          docType: 'application',
          aggregateId: String(row._id),
          reason,
          fingerprint: `backfill:application:${String(row._id)}:${Date.now()}`,
        });
        if (out.length >= limit) return out;
      }
    }
    if (include(options.docType, 'cv')) {
      const filter =
        options.userId === undefined ? {} : { userId: options.userId };
      const rows = await this.connection
        .collection('cv_documents')
        .find(filter, { projection: { _id: 1 }, limit: limit - out.length })
        .toArray();
      for (const row of rows) {
        out.push({
          docType: 'cv',
          aggregateId: String(row._id),
          reason,
          fingerprint: `backfill:cv:${String(row._id)}:${Date.now()}`,
        });
        if (out.length >= limit) return out;
      }
    }
    if (include(options.docType, 'roadmap')) {
      const filter =
        options.userId === undefined ? {} : { userId: options.userId };
      const rows = await this.connection
        .collection('roadmaps')
        .find(
          { ...filter, status: 'ready' },
          { projection: { _id: 1 }, limit: limit - out.length },
        )
        .toArray();
      for (const row of rows) {
        out.push({
          docType: 'roadmap',
          aggregateId: String(row._id),
          reason,
          fingerprint: `backfill:roadmap:${String(row._id)}:${Date.now()}`,
        });
        if (out.length >= limit) return out;
      }
    }
    if (include(options.docType, 'group_comment')) {
      const rows = await this.connection
        .collection('group_link_comments')
        .find(
          options.userId === undefined
            ? {}
            : { authorId: options.userId },
          { projection: { _id: 1 }, limit: limit - out.length },
        )
        .toArray();
      for (const row of rows) {
        out.push({
          docType: 'group_comment',
          aggregateId: String(row._id),
          reason,
          fingerprint: `backfill:group_comment:${String(row._id)}:${Date.now()}`,
        });
        if (out.length >= limit) return out;
      }
    }
    if (include(options.docType, 'group_link_note')) {
      const filter =
        options.userId === undefined
          ? { 'note.text': { $exists: true } }
          : { 'note.authorId': options.userId };
      const rows = await this.connection
        .collection('group_links')
        .find(filter, {
          projection: { groupId: 1, linkId: 1 },
          limit: limit - out.length,
        })
        .toArray();
      for (const row of rows) {
        const aggregateId = `${String(row['groupId'])}_${String(row['linkId'])}`;
        out.push({
          docType: 'group_link_note',
          aggregateId,
          reason,
          fingerprint: `backfill:group_link_note:${aggregateId}:${Date.now()}`,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private async enqueue(candidate: BackfillCandidate): Promise<void> {
    // Backfill sin txn de agregado: sesión null no existe en Outbox — usamos una txn corta.
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.outbox.append(
          searchUpsertEvent({
            docType: candidate.docType,
            aggregateId: candidate.aggregateId,
            reason: candidate.reason,
            contentHash: searchContentHash(candidate.fingerprint),
          }),
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
}

function include(
  filter: SearchDocType | undefined,
  docType: SearchDocType,
): boolean {
  return filter === undefined || filter === docType;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackfillSearchOptions {
  readonly limit: number;
  readonly dryRun?: boolean;
  readonly reembed?: boolean;
  readonly userId?: string;
  readonly docType?: SearchDocType;
}

export interface BackfillSearchReport {
  readonly found: number;
  readonly enqueued: number;
}

interface BackfillCandidate {
  readonly docType: SearchDocType;
  readonly aggregateId: string;
  readonly reason: SearchUpsertReason;
  readonly fingerprint: string;
}
