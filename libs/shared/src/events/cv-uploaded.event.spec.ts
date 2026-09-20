import { describe, expect, it } from 'vitest';
import {
  CV_UPLOADED_EVENT_TYPE,
  EXTRACT_CV_QUEUE,
  cvUploadedEvent,
  cvUploadedEventSchema,
  cvUploadedJobId,
  cvUploadedPayloadSchema,
} from './cv-uploaded.event';

const payload = {
  cvId: '66e9a0000000000000000001',
  userId: '66e9a0000000000000000002',
} as const;

describe('cvUploadedEventSchema', () => {
  it('accepts a complete event', () => {
    const event = { type: CV_UPLOADED_EVENT_TYPE, payload } as const;

    expect(cvUploadedEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an event without cvId', () => {
    const result = cvUploadedEventSchema.safeParse({
      type: CV_UPLOADED_EVENT_TYPE,
      payload: { userId: payload.userId },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'payload.cvId',
    ]);
  });

  it.each(['fileName', 'fileType', 'sizeBytes'])(
    'rejects a payload carrying %s',
    (field) => {
      expect(
        cvUploadedPayloadSchema.safeParse({ ...payload, [field]: 'x' }).success,
      ).toBe(false);
    },
  );

  it('rejects another event type', () => {
    expect(
      cvUploadedEventSchema.safeParse({ type: 'CvUploaded', payload }).success,
    ).toBe(false);
  });
});

describe('cvUploadedEvent', () => {
  it('carries the versioned type', () => {
    expect(cvUploadedEvent(payload)).toEqual({
      type: 'CvUploaded.v1',
      payload,
    });
  });
});

describe('cvUploadedJobId', () => {
  it('is deterministic for the same CV', () => {
    expect(cvUploadedJobId(payload)).toBe(
      'cv:66e9a0000000000000000001:extract',
    );
    expect(cvUploadedJobId(payload)).toBe(cvUploadedJobId({ ...payload }));
  });

  it('changes with the CV', () => {
    expect(cvUploadedJobId({ ...payload, cvId: 'otro' })).not.toBe(
      cvUploadedJobId(payload),
    );
  });
});

describe('the queue of the event', () => {
  it('names the extract-cv queue', () => {
    expect(EXTRACT_CV_QUEUE).toBe('extract-cv');
  });
});
