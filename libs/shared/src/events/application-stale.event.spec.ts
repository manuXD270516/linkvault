import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STALE_AFTER_DAYS,
  APPLICATION_STALE_EVENT_TYPE,
  applicationStaleEvent,
  applicationStaleEventSchema,
} from './application-stale.event';

const payload = {
  applicationId: '66e9a0000000000000000009',
  userId: '66e9a00000000000000000a1',
  linkId: '66e9a0000000000000000001',
  status: 'applied',
  lastChangedAt: '2026-09-05T10:00:00.000Z',
  staleAfterDays: APPLICATION_STALE_AFTER_DAYS,
} as const;

// "El contrato existe" (applications/tracking, "Postulación estancada, solo modelada").
describe('applicationStaleEventSchema', () => {
  it('accepts an event with all its fields', () => {
    const event = applicationStaleEvent(payload);

    expect(applicationStaleEventSchema.parse(event)).toEqual(event);
  });

  it('carries the versioned type and a threshold of 10 days', () => {
    expect(APPLICATION_STALE_EVENT_TYPE).toBe('ApplicationStale.v1');
    expect(APPLICATION_STALE_AFTER_DAYS).toBe(10);
    expect(applicationStaleEvent(payload).type).toBe('ApplicationStale.v1');
  });

  it('rejects the same event with another type', () => {
    expect(
      applicationStaleEventSchema.safeParse({
        type: 'ApplicationStale.v2',
        payload,
      }).success,
    ).toBe(false);
  });

  it('rejects the same event without the application id', () => {
    const { applicationId: _id, ...withoutId } = payload;
    const result = applicationStaleEventSchema.safeParse({
      type: APPLICATION_STALE_EVENT_TYPE,
      payload: withoutId,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'payload.applicationId',
    ]);
  });

  it('rejects private details such as the stage or the notes', () => {
    expect(
      applicationStaleEventSchema.safeParse({
        type: APPLICATION_STALE_EVENT_TYPE,
        payload: { ...payload, stageLabel: 'Entrevista' },
      }).success,
    ).toBe(false);
  });
});
