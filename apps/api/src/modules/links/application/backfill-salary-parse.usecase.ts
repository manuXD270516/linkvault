import {
  applySalaryTextParse,
  shouldApplySalaryTextParse,
  type PreviewSources,
  type StoredPreview,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';

/**
 * Paso 1 del backfill two-step (ADR-046): parsea `summary` → `$set` de salary en Mongo.
 * **No** escribe Meili ni outbox SearchUpsert; el paso 2 es `api:backfill-search`.
 */
@Injectable()
export class BackfillSalaryParse {
  private readonly logger = new Logger(BackfillSalaryParse.name);

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    options: BackfillSalaryParseOptions,
  ): Promise<BackfillSalaryParseReport> {
    const candidates = await this.collect(options.limit);
    if (options.dryRun) {
      return { found: candidates.length, updated: 0 };
    }

    const at = this.clock.now().toISOString();
    let updated = 0;
    for (const candidate of candidates) {
      const did = await this.applyOne(candidate, at);
      if (did) updated += 1;
    }
    this.logger.log(
      `Salary-parse backfill updated ${updated} of ${candidates.length} candidates`,
    );
    return { found: candidates.length, updated };
  }

  private async collect(limit: number): Promise<SalaryParseCandidate[]> {
    const rows = await this.connection
      .collection('job_links')
      .find(
        {
          'preview.summary': { $exists: true, $type: 'string', $ne: '' },
          'previewSources.salary.source': { $nin: ['manual', 'pasted'] },
          $and: [
            {
              $or: [
                { 'preview.salary': { $exists: false } },
                { 'preview.salary': null },
                { 'preview.salary.min': null },
                { 'preview.salary.min': { $exists: false } },
              ],
            },
            {
              $or: [
                { 'preview.salary': { $exists: false } },
                { 'preview.salary': null },
                { 'preview.salary.max': null },
                { 'preview.salary.max': { $exists: false } },
              ],
            },
          ],
        },
        {
          projection: {
            _id: 1,
            preview: 1,
            previewSources: 1,
            previewVersion: 1,
          },
          limit,
        },
      )
      .toArray();

    const out: SalaryParseCandidate[] = [];
    for (const row of rows) {
      const id = objectIdHex(row._id);
      if (id === null) continue;
      const preview = (row['preview'] ?? {}) as StoredPreview;
      const sources = (row['previewSources'] ?? {}) as PreviewSources;
      if (!shouldApplySalaryTextParse(preview, sources)) continue;
      if (typeof preview.summary !== 'string' || preview.summary.trim() === '') {
        continue;
      }
      out.push({
        id,
        preview,
        sources,
        previewVersion:
          typeof row['previewVersion'] === 'number' ? row['previewVersion'] : 0,
      });
    }
    return out;
  }

  private async applyOne(
    candidate: SalaryParseCandidate,
    at: string,
  ): Promise<boolean> {
    const summary = candidate.preview.summary;
    if (typeof summary !== 'string') return false;
    const result = applySalaryTextParse(
      candidate.preview,
      candidate.sources,
      summary,
      at,
    );
    if (!result.applied || result.preview.salary === undefined) return false;

    const objectId = new Types.ObjectId(candidate.id);
    const updateResult = await this.connection.collection('job_links').updateOne(
      {
        _id: objectId,
        previewVersion: candidate.previewVersion,
      },
      {
        $set: {
          'preview.salary': result.preview.salary,
          'previewSources.salary': result.sources.salary,
          previewVersion: candidate.previewVersion + 1,
          updatedAt: new Date(at),
        },
      },
    );
    return updateResult.modifiedCount === 1;
  }
}

export interface BackfillSalaryParseOptions {
  readonly limit: number;
  readonly dryRun?: boolean;
}

export interface BackfillSalaryParseReport {
  readonly found: number;
  readonly updated: number;
}

interface SalaryParseCandidate {
  readonly id: string;
  readonly preview: StoredPreview;
  readonly sources: PreviewSources;
  readonly previewVersion: number;
}

function objectIdHex(value: unknown): string | null {
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return value;
  return null;
}
