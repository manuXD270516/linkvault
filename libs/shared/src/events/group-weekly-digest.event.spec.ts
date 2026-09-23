import { describe, expect, it } from 'vitest';
import {
  GROUP_DIGEST_QUEUE,
  GROUP_WEEKLY_DIGEST_TYPE,
  groupDigestAggregateKey,
  groupDigestJobId,
  groupDigestJobPayloadSchema,
} from './group-weekly-digest.event';

describe('group weekly digest helpers', () => {
  it('jobId single-flight y aggregateKey', () => {
    expect(groupDigestJobId('2026-W38')).toBe('digest:week:2026-W38');
    expect(groupDigestAggregateKey('2026-W38', 'g1')).toBe('2026-W38:g1');
    expect(GROUP_WEEKLY_DIGEST_TYPE).toBe('group_weekly_digest');
    expect(GROUP_DIGEST_QUEUE).toBe('group-digest');
  });

  it('payload exige weekKey ISO', () => {
    expect(
      groupDigestJobPayloadSchema.safeParse({ weekKey: '2026-W38' }).success,
    ).toBe(true);
    expect(
      groupDigestJobPayloadSchema.safeParse({ weekKey: '2026W38' }).success,
    ).toBe(false);
  });
});
