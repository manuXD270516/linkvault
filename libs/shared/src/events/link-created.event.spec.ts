import { describe, expect, it } from 'vitest';
import {
  ENRICH_LINK_QUEUE,
  LINK_CREATED_EVENT_TYPE,
  linkCreatedEvent,
  linkCreatedEventSchema,
  linkCreatedJobId,
  linkCreatedPayloadSchema,
} from './link-created.event';

const payload = {
  linkId: '66e9a0000000000000000001',
  previewVersion: 1,
} as const;

describe('linkCreatedEventSchema', () => {
  it('accepts a complete event', () => {
    const event = { type: LINK_CREATED_EVENT_TYPE, payload } as const;

    expect(linkCreatedEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an event without linkId', () => {
    const result = linkCreatedEventSchema.safeParse({
      type: LINK_CREATED_EVENT_TYPE,
      payload: { previewVersion: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'payload.linkId',
    ]);
  });

  it('rejects another event type and any extra field', () => {
    expect(
      linkCreatedEventSchema.safeParse({ type: 'LinkCreated', payload })
        .success,
    ).toBe(false);
    expect(
      linkCreatedEventSchema.safeParse({
        type: LINK_CREATED_EVENT_TYPE,
        payload: { ...payload, url: 'https://example.com/jobs/1' },
      }).success,
    ).toBe(false);
  });

  it('rejects a preview version that is not a positive integer', () => {
    expect(
      linkCreatedPayloadSchema.safeParse({ ...payload, previewVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      linkCreatedPayloadSchema.safeParse({ ...payload, previewVersion: 1.5 })
        .success,
    ).toBe(false);
  });
});

describe('linkCreatedEvent', () => {
  it('carries the versioned type', () => {
    expect(linkCreatedEvent(payload)).toEqual({
      type: 'LinkCreated.v1',
      payload,
    });
  });
});

describe('linkCreatedJobId', () => {
  it('is deterministic for the same link and preview version', () => {
    expect(linkCreatedJobId(payload)).toBe(
      'enrich:66e9a0000000000000000001:1',
    );
    expect(linkCreatedJobId(payload)).toBe(linkCreatedJobId({ ...payload }));
  });

  it('changes with the preview version', () => {
    expect(linkCreatedJobId({ ...payload, previewVersion: 2 })).not.toBe(
      linkCreatedJobId(payload),
    );
  });
});

describe('the queue of the event', () => {
  it('names the enrich-link queue', () => {
    expect(ENRICH_LINK_QUEUE).toBe('enrich-link');
  });
});
