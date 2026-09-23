import { describe, expect, it } from 'vitest';
import {
  freshnessBucket,
  freshnessRecheckJobId,
  freshnessRecheckPayloadSchema,
  utcDayNumber,
} from './link-freshness.event';

describe('freshness re-check job identity', () => {
  it('builds a three-segment jobId with the cadence bucket', () => {
    const day = new Date('2026-09-22T15:30:00.000Z');
    const bucket = freshnessBucket(day, 7);
    const jobId = freshnessRecheckJobId('link1', bucket);

    expect(jobId.split(':')).toHaveLength(3);
    expect(jobId).toBe(`fresh:link1:${bucket}`);
  });

  it('keeps the same bucket for days in the same interval window', () => {
    const interval = 7;
    // Pick a day that sits at the start of a bucket so +6 days stay inside.
    const day = utcDayNumber(new Date('2026-09-22T00:00:00.000Z'));
    const bucketStartDay = Math.floor(day / interval) * interval;
    const startMs = bucketStartDay * 86_400_000;
    const start = new Date(startMs);
    const bucket = freshnessBucket(start, interval);
    const sameWindow = new Date(startMs + 6 * 86_400_000);
    expect(freshnessBucket(sameWindow, interval)).toBe(bucket);
    const nextWindow = new Date(startMs + interval * 86_400_000);
    expect(freshnessBucket(nextWindow, interval)).toBe(bucket + 1);
  });

  it('computes utc day number from UTC midnight, not local', () => {
    expect(utcDayNumber(new Date('2026-09-22T00:00:00.000Z'))).toBe(
      utcDayNumber(new Date('2026-09-22T23:59:59.999Z')),
    );
  });

  it('requires triggeredBy freshness on the re-check payload', () => {
    expect(
      freshnessRecheckPayloadSchema.parse({
        linkId: 'l1',
        previewVersion: 2,
        triggeredBy: 'freshness',
      }),
    ).toEqual({
      linkId: 'l1',
      previewVersion: 2,
      triggeredBy: 'freshness',
    });
    expect(
      freshnessRecheckPayloadSchema.safeParse({
        linkId: 'l1',
        previewVersion: 2,
      }).success,
    ).toBe(false);
  });
});
