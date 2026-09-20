import { describe, expect, it } from 'vitest';
import {
  CV_DELETED_EVENT_TYPE,
  DELETE_CV_FILE_QUEUE,
  cvDeletedEvent,
  cvDeletedEventSchema,
  cvDeletedJobId,
  cvDeletedPayloadSchema,
} from './cv-deleted.event';
import { EXTRACT_CV_QUEUE } from './cv-uploaded.event';

const payload = {
  cvId: '66e9a0000000000000000001',
  userId: '66e9a0000000000000000002',
} as const;

describe('cvDeletedEventSchema', () => {
  it('accepts a complete event', () => {
    const event = { type: CV_DELETED_EVENT_TYPE, payload } as const;

    expect(cvDeletedEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an event without userId', () => {
    const result = cvDeletedEventSchema.safeParse({
      type: CV_DELETED_EVENT_TYPE,
      payload: { cvId: payload.cvId },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'payload.userId',
    ]);
  });

  it.each(['fileName', 'fileKey', 'sizeBytes'])(
    'rejects a payload carrying %s',
    (field) => {
      expect(
        cvDeletedPayloadSchema.safeParse({ ...payload, [field]: 'x' }).success,
      ).toBe(false);
    },
  );
});

describe('cvDeletedEvent', () => {
  it('carries the versioned type', () => {
    expect(cvDeletedEvent(payload)).toEqual({
      type: 'CvDeleted.v1',
      payload,
    });
  });
});

describe('cvDeletedJobId', () => {
  it('is deterministic for the same CV', () => {
    expect(cvDeletedJobId(payload)).toBe(
      'cv:66e9a0000000000000000001:delete',
    );
  });
});

describe('the queue of the event', () => {
  it('names the delete-cv-file queue, apart from the extraction one', () => {
    expect(DELETE_CV_FILE_QUEUE).toBe('delete-cv-file');
    expect(DELETE_CV_FILE_QUEUE).not.toBe(EXTRACT_CV_QUEUE);
  });
});
