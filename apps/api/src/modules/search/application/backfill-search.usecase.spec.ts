import { describe, expect, it } from 'vitest';
import { BackfillSearch } from './backfill-search.usecase';
import type { Outbox } from '../../../infrastructure/outbox/outbox.port';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { SEARCH_UPSERT_EVENT_TYPE } from '@linkvault/shared';

describe('BackfillSearch', () => {
  it('dry-run counts without enqueueing', async () => {
    const connection = {
      collection: () => ({
        find: () => ({
          toArray: async () => [{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }],
        }),
      }),
      startSession: async () => {
        throw new Error('should not start session on dry-run');
      },
    };
    const outbox: Outbox = {
      append: async () => {
        throw new Error('should not append');
      },
    };
    const useCase = new BackfillSearch(
      connection as never,
      outbox,
      {
        FEATURE_SEARCH: true,
        SEARCH_BACKFILL_RATE: 100,
      } as ApiConfig,
    );
    const report = await useCase.execute({
      limit: 10,
      dryRun: true,
      docType: 'job_preview',
    });
    expect(report.found).toBe(1);
    expect(report.enqueued).toBe(0);
  });

  it('skips when FEATURE_SEARCH=false', async () => {
    const useCase = new BackfillSearch(
      {} as never,
      { append: async () => undefined },
      { FEATURE_SEARCH: false, SEARCH_BACKFILL_RATE: 5 } as ApiConfig,
    );
    await expect(useCase.execute({ limit: 5 })).resolves.toEqual({
      found: 0,
      enqueued: 0,
    });
  });

  it('enqueues upserts with rate limit without saturating', async () => {
    const appended: string[] = [];
    const connection = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
            { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
          ],
        }),
      }),
      startSession: async () => ({
        withTransaction: async (fn: () => Promise<void>) => fn(),
        endSession: async () => undefined,
      }),
    };
    const outbox: Outbox = {
      append: async (event) => {
        appended.push(event.type);
      },
    };
    const useCase = new BackfillSearch(
      connection as never,
      outbox,
      {
        FEATURE_SEARCH: true,
        SEARCH_BACKFILL_RATE: 1000,
      } as ApiConfig,
    );
    const report = await useCase.execute({
      limit: 10,
      docType: 'job_preview',
    });
    expect(report.enqueued).toBe(2);
    expect(appended.every((t) => t === SEARCH_UPSERT_EVENT_TYPE)).toBe(true);
  });
});
