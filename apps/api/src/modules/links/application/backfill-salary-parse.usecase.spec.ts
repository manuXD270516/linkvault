import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { PARSE_SALARY_TEXT_EXTRACTOR } from '@linkvault/shared';
import { BackfillSalaryParse } from './backfill-salary-parse.usecase';

const LINK_ID = '68c0f0f0f0f0f0f0f0f0f0f0';
const AT = new Date('2026-09-23T15:00:00.000Z');

describe('BackfillSalaryParse', () => {
  it('dry-run counts without writing', async () => {
    const updateOne = vi.fn();
    const connection = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            {
              _id: new Types.ObjectId(LINK_ID),
              previewVersion: 2,
              preview: {
                summary: 'Sueldo Bs. 8500 mensuales',
              },
              previewSources: {},
            },
          ],
        }),
        updateOne,
      }),
    };
    const useCase = new BackfillSalaryParse(connection as never, {
      now: () => AT,
    });

    const report = await useCase.execute({ limit: 10, dryRun: true });
    expect(report).toEqual({ found: 1, updated: 0 });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('parses summary and $sets salary without Meili', async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const connection = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            {
              _id: new Types.ObjectId(LINK_ID),
              previewVersion: 2,
              preview: {
                summary: 'Sueldo Bs. 8500 mensuales',
                salary: {
                  min: null,
                  max: null,
                  currency: null,
                  period: null,
                },
              },
              previewSources: {},
            },
          ],
        }),
        updateOne,
      }),
    };
    const useCase = new BackfillSalaryParse(connection as never, {
      now: () => AT,
    });

    const report = await useCase.execute({ limit: 10 });
    expect(report).toEqual({ found: 1, updated: 1 });
    expect(updateOne).toHaveBeenCalledTimes(1);
    const args = updateOne.mock.calls[0] as unknown as
      | [unknown, { $set: Record<string, unknown> }]
      | undefined;
    expect(args).toBeDefined();
    if (args === undefined) return;
    const update = args[1];
    expect(update.$set['preview.salary']).toEqual({
      min: 8500,
      max: 8500,
      currency: 'BOB',
      period: 'month',
    });
    // Tras `api:backfill-search`, el loader mapea estos extremos a salaryMin/Max (ADR-040).
    const salary = update.$set['preview.salary'] as {
      min: number;
      max: number;
    };
    expect({ salaryMin: salary.min, salaryMax: salary.max }).toEqual({
      salaryMin: 8500,
      salaryMax: 8500,
    });
    expect(update.$set['previewSources.salary']).toMatchObject({
      source: 'auto',
      extractor: PARSE_SALARY_TEXT_EXTRACTOR,
    });
    expect(update.$set['previewVersion']).toBe(3);
  });

  it('skips candidates that already have a numeric extreme', async () => {
    const updateOne = vi.fn();
    const connection = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            {
              _id: new Types.ObjectId(LINK_ID),
              previewVersion: 1,
              preview: {
                summary: 'USD 3000 monthly',
                salary: { min: 1000, max: null, currency: 'USD', period: null },
              },
              previewSources: {},
            },
          ],
        }),
        updateOne,
      }),
    };
    const useCase = new BackfillSalaryParse(connection as never, {
      now: () => AT,
    });

    const report = await useCase.execute({ limit: 10 });
    expect(report).toEqual({ found: 0, updated: 0 });
    expect(updateOne).not.toHaveBeenCalled();
  });
});
