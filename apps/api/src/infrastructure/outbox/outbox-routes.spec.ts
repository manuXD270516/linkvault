import {
  CV_DELETED_EVENT_TYPE,
  CV_UPLOADED_EVENT_TYPE,
  DELETE_CV_FILE_QUEUE,
  ENRICH_LINK_QUEUE,
  EXTRACT_CV_QUEUE,
  LINK_CREATED_EVENT_TYPE,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  OUTBOX_QUEUES,
  OUTBOX_ROUTES,
  outboxRouteOf,
} from './outbox-routes';

describe('the outbox routing table', () => {
  it('covers exactly the event types declared in the shared contract', () => {
    expect(Object.keys(OUTBOX_ROUTES).sort()).toEqual(
      [
        LINK_CREATED_EVENT_TYPE,
        CV_UPLOADED_EVENT_TYPE,
        CV_DELETED_EVENT_TYPE,
      ].sort(),
    );
  });

  it('gives every type its own queue', () => {
    const queues = Object.values(OUTBOX_ROUTES).map((route) => route.queue);

    expect(queues).toEqual([
      ENRICH_LINK_QUEUE,
      EXTRACT_CV_QUEUE,
      DELETE_CV_FILE_QUEUE,
    ]);
    expect(new Set(queues).size).toBe(queues.length);
  });

  it('lists the queues the relay has to register', () => {
    expect([...OUTBOX_QUEUES].sort()).toEqual(
      [ENRICH_LINK_QUEUE, EXTRACT_CV_QUEUE, DELETE_CV_FILE_QUEUE].sort(),
    );
  });

  it('builds the deterministic job of each type from its own contract', () => {
    expect(
      outboxRouteOf(LINK_CREATED_EVENT_TYPE)?.job({
        linkId: 'l1',
        previewVersion: 1,
      }),
    ).toEqual({ data: { linkId: 'l1', previewVersion: 1 }, jobId: 'enrich:l1:1' });
    expect(
      outboxRouteOf(CV_UPLOADED_EVENT_TYPE)?.job({ cvId: 'c1', userId: 'u1' }),
    ).toEqual({
      data: { cvId: 'c1', userId: 'u1' },
      jobId: 'extract-cv:c1',
    });
    expect(
      outboxRouteOf(CV_DELETED_EVENT_TYPE)?.job({ cvId: 'c1', userId: 'u1' }),
    ).toEqual({
      data: { cvId: 'c1', userId: 'u1' },
      jobId: 'delete-cv-file:c1',
    });
  });

  it('throws when the payload does not meet its schema', () => {
    expect(() =>
      outboxRouteOf(CV_UPLOADED_EVENT_TYPE)?.job({ cvId: 'c1' }),
    ).toThrow();
    expect(() =>
      outboxRouteOf(CV_DELETED_EVENT_TYPE)?.job({
        cvId: 'c1',
        userId: 'u1',
        fileName: 'CV_Ana_Perez.pdf',
      }),
    ).toThrow();
  });

  it('does not know an unknown type, nor anything inherited from Object', () => {
    expect(outboxRouteOf('Whatever.v9')).toBeUndefined();
    expect(outboxRouteOf('toString')).toBeUndefined();
  });
});
