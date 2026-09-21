import { describe, expect, it } from 'vitest';
import {
  ANALYZE_MATCH_QUEUE,
  MATCH_REQUESTED_EVENT_TYPE,
  matchRequestedEvent,
  matchRequestedEventSchema,
  matchRequestedJobId,
  matchRequestedPayloadSchema,
} from './match-requested.event';

const payload = {
  analysisId: '66e9a0000000000000000001',
  userId: '66e9a0000000000000000002',
  linkId: '66e9a0000000000000000003',
  cvId: '66e9a0000000000000000004',
} as const;

describe('matchRequestedEventSchema', () => {
  it('accepts a complete event', () => {
    const event = { type: MATCH_REQUESTED_EVENT_TYPE, payload } as const;

    expect(matchRequestedEventSchema.parse(event)).toEqual(event);
  });

  it.each(['cvText', 'jobText', 'prompt', 'fileName', 'score'])(
    'rejects a payload carrying %s',
    (field) => {
      expect(
        matchRequestedPayloadSchema.safeParse({ ...payload, [field]: 'x' })
          .success,
      ).toBe(false);
    },
  );

  it('rejects another event type', () => {
    expect(
      matchRequestedEventSchema.safeParse({
        type: 'MatchRequested',
        payload,
      }).success,
    ).toBe(false);
  });
});

describe('matchRequestedEvent', () => {
  it('carries the versioned type', () => {
    expect(matchRequestedEvent(payload)).toEqual({
      type: 'MatchRequested.v1',
      payload,
    });
  });
});

describe('matchRequestedJobId', () => {
  it('uses exactly three colon-separated segments', () => {
    const jobId = matchRequestedJobId(payload);

    expect(jobId).toBe('match:66e9a0000000000000000001:analyze');
    expect(jobId.split(':')).toHaveLength(3);
  });

  it('is deterministic for the same analysis', () => {
    expect(matchRequestedJobId(payload)).toBe(matchRequestedJobId({ ...payload }));
  });

  it('changes with the analysis', () => {
    expect(
      matchRequestedJobId({ ...payload, analysisId: 'otro' }),
    ).not.toBe(matchRequestedJobId(payload));
  });
});

describe('the queue of the event', () => {
  it('names the analyze-match queue', () => {
    expect(ANALYZE_MATCH_QUEUE).toBe('analyze-match');
  });
});
