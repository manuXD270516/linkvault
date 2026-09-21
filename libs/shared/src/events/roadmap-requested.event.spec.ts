import { describe, expect, it } from 'vitest';
import {
  BUILD_ROADMAP_QUEUE,
  ROADMAP_REQUESTED_EVENT_TYPE,
  roadmapRequestedEvent,
  roadmapRequestedEventSchema,
  roadmapRequestedJobId,
  roadmapRequestedPayloadSchema,
} from './roadmap-requested.event';

const payload = {
  analysisId: '66e9a0000000000000000001',
  userId: '66e9a0000000000000000002',
} as const;

describe('roadmapRequestedEventSchema', () => {
  it('accepts a complete event', () => {
    const event = { type: ROADMAP_REQUESTED_EVENT_TYPE, payload } as const;

    expect(roadmapRequestedEventSchema.parse(event)).toEqual(event);
  });

  it.each(['items', 'status', 'prompt', 'missingSkills'])(
    'rejects a payload carrying %s',
    (field) => {
      expect(
        roadmapRequestedPayloadSchema.safeParse({ ...payload, [field]: 'x' })
          .success,
      ).toBe(false);
    },
  );

  it('rejects another event type', () => {
    expect(
      roadmapRequestedEventSchema.safeParse({
        type: 'RoadmapRequested',
        payload,
      }).success,
    ).toBe(false);
  });
});

describe('roadmapRequestedEvent', () => {
  it('carries the versioned type', () => {
    expect(roadmapRequestedEvent(payload)).toEqual({
      type: 'RoadmapRequested.v1',
      payload,
    });
  });
});

describe('roadmapRequestedJobId', () => {
  it('uses exactly three colon-separated segments', () => {
    const jobId = roadmapRequestedJobId(payload);

    expect(jobId).toBe('roadmap:66e9a0000000000000000001:build');
    expect(jobId.split(':')).toHaveLength(3);
  });

  it('is deterministic for the same analysis', () => {
    expect(roadmapRequestedJobId(payload)).toBe(
      roadmapRequestedJobId({ ...payload }),
    );
  });

  it('changes with the analysis', () => {
    expect(
      roadmapRequestedJobId({ ...payload, analysisId: 'otro' }),
    ).not.toBe(roadmapRequestedJobId(payload));
  });
});

describe('the queue of the event', () => {
  it('names the build-roadmap queue', () => {
    expect(BUILD_ROADMAP_QUEUE).toBe('build-roadmap');
  });
});
