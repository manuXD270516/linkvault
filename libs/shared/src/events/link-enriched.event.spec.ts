import { describe, expect, it } from 'vitest';
import {
  LINK_ENRICHED_CHANNEL,
  LINK_ENRICHED_EVENT_NAME,
  LINK_ENRICHED_EVENT_TYPE,
  linkEnrichedEvent,
  linkEnrichedEventSchema,
  linkEnrichedMessage,
  linkEnrichedMessageSchema,
  linkEnrichedPayloadSchema,
} from './link-enriched.event';

const payload = {
  linkId: '66e9a0000000000000000001',
  previewStatus: 'enriched',
  previewVersion: 2,
} as const;

describe('linkEnrichedEventSchema', () => {
  it('accepts a complete notice', () => {
    const event = { type: LINK_ENRICHED_EVENT_TYPE, payload } as const;

    expect(linkEnrichedEventSchema.parse(event)).toEqual(event);
  });

  it('rejects a preview version of zero, or one that is not a positive integer', () => {
    expect(
      linkEnrichedPayloadSchema.safeParse({ ...payload, previewVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      linkEnrichedPayloadSchema.safeParse({ ...payload, previewVersion: -1 })
        .success,
    ).toBe(false);
    expect(
      linkEnrichedPayloadSchema.safeParse({ ...payload, previewVersion: 1.5 })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown preview state and another event type', () => {
    expect(
      linkEnrichedPayloadSchema.safeParse({
        ...payload,
        previewStatus: 'reading',
      }).success,
    ).toBe(false);
    expect(
      linkEnrichedEventSchema.safeParse({ type: 'LinkEnriched', payload })
        .success,
    ).toBe(false);
  });

  it('carries nothing the recipient could not already see', () => {
    expect(Object.keys(linkEnrichedPayloadSchema.shape)).toEqual([
      'linkId',
      'previewStatus',
      'previewVersion',
    ]);
    expect(
      linkEnrichedEventSchema.safeParse({
        type: LINK_ENRICHED_EVENT_TYPE,
        payload: { ...payload, displayUrl: 'https://example.com/jobs/1' },
      }).success,
    ).toBe(false);
  });
});

describe('linkEnrichedEvent', () => {
  it('carries the versioned type', () => {
    expect(linkEnrichedEvent(payload)).toEqual({
      type: 'LinkEnriched.v1',
      payload,
    });
  });
});

describe('the channel of the notice', () => {
  it('names the link enrichment channel', () => {
    expect(LINK_ENRICHED_CHANNEL).toBe('events:link.enriched');
  });
});

describe('link.enriched over the events channel', () => {
  const link = {
    id: '000000000000000000000007',
    normalizedUrl: 'https://empresa.example/careers/backend',
    displayUrl: 'https://empresa.example/careers/backend',
    platform: 'generic',
    previewStatus: 'enriched',
    previewVersion: 2,
    preview: { title: 'Backend Engineer', company: 'Acme' },
    previewRequestedAt: '2026-09-18T11:00:00.000Z',
    sharedAt: '2026-09-18T11:00:00.000Z',
  } as const;

  it('names the event once for the server and for the browser', () => {
    expect(LINK_ENRICHED_EVENT_NAME).toBe('link.enriched');
  });

  it('carries the updated link wrapped in an object, so the message can grow', () => {
    const message = linkEnrichedMessage(link);

    expect(linkEnrichedMessageSchema.parse(message)).toEqual({ link });
  });

  it('rejects a body that is the link on its own', () => {
    expect(linkEnrichedMessageSchema.safeParse(link).success).toBe(false);
  });
});
