import {
  ANALYZE_MATCH_QUEUE,
  APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
  BUILD_ROADMAP_QUEUE,
  CV_DELETED_EVENT_TYPE,
  CV_UPLOADED_EVENT_TYPE,
  DELETE_CV_FILE_QUEUE,
  ENRICH_LINK_QUEUE,
  EXTRACT_CV_QUEUE,
  GROUP_LINK_ADDED_EVENT_TYPE,
  LINK_CREATED_EVENT_TYPE,
  MATCH_REQUESTED_EVENT_TYPE,
  NOTIFY_FANOUT_QUEUE,
  ROADMAP_REQUESTED_EVENT_TYPE,
  SEARCH_DELETE_EVENT_TYPE,
  SEARCH_INDEX_QUEUE,
  SEARCH_UPSERT_EVENT_TYPE,
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
        MATCH_REQUESTED_EVENT_TYPE,
        ROADMAP_REQUESTED_EVENT_TYPE,
        GROUP_LINK_ADDED_EVENT_TYPE,
        APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
        SEARCH_UPSERT_EVENT_TYPE,
        SEARCH_DELETE_EVENT_TYPE,
      ].sort(),
    );
  });

  it('routes notification fan-out types to the shared notify queue', () => {
    expect(OUTBOX_ROUTES[GROUP_LINK_ADDED_EVENT_TYPE]?.queue).toBe(
      NOTIFY_FANOUT_QUEUE,
    );
    expect(OUTBOX_ROUTES[APPLICATION_STATUS_NOTIFY_EVENT_TYPE]?.queue).toBe(
      NOTIFY_FANOUT_QUEUE,
    );
  });

  it('routes search index types to the search-index queue', () => {
    expect(OUTBOX_ROUTES[SEARCH_UPSERT_EVENT_TYPE]?.queue).toBe(
      SEARCH_INDEX_QUEUE,
    );
    expect(OUTBOX_ROUTES[SEARCH_DELETE_EVENT_TYPE]?.queue).toBe(
      SEARCH_INDEX_QUEUE,
    );
  });

  it('lists the queues the relay has to register', () => {
    expect([...OUTBOX_QUEUES].sort()).toEqual(
      [
        ENRICH_LINK_QUEUE,
        EXTRACT_CV_QUEUE,
        DELETE_CV_FILE_QUEUE,
        ANALYZE_MATCH_QUEUE,
        BUILD_ROADMAP_QUEUE,
        NOTIFY_FANOUT_QUEUE,
        SEARCH_INDEX_QUEUE,
      ].sort(),
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
      jobId: 'cv:c1:extract',
    });
    expect(
      outboxRouteOf(CV_DELETED_EVENT_TYPE)?.job({ cvId: 'c1', userId: 'u1' }),
    ).toEqual({
      data: { cvId: 'c1', userId: 'u1' },
      jobId: 'cv:c1:delete',
    });
    expect(
      outboxRouteOf(MATCH_REQUESTED_EVENT_TYPE)?.job({
        analysisId: 'a1',
        userId: 'u1',
        linkId: 'l1',
        cvId: 'c1',
      }),
    ).toEqual({
      data: { analysisId: 'a1', userId: 'u1', linkId: 'l1', cvId: 'c1' },
      jobId: 'match:a1:analyze',
    });
    expect(
      outboxRouteOf(ROADMAP_REQUESTED_EVENT_TYPE)?.job({
        analysisId: 'a1',
        userId: 'u1',
      }),
    ).toEqual({
      data: { analysisId: 'a1', userId: 'u1' },
      jobId: 'roadmap:a1:build',
    });
    expect(
      outboxRouteOf(GROUP_LINK_ADDED_EVENT_TYPE)?.job({
        groupId: 'g1',
        linkId: 'l1',
        actorUserId: 'u1',
      }),
    ).toEqual({
      data: { groupId: 'g1', linkId: 'l1', actorUserId: 'u1' },
      jobId: 'notify:gla:g1_l1_u1',
    });
    expect(
      outboxRouteOf(APPLICATION_STATUS_NOTIFY_EVENT_TYPE)?.job({
        applicationId: 'a1',
        linkId: 'l1',
        actorUserId: 'u1',
        status: 'applied',
        statusChangedAt: '2026-09-22T12:00:00.000Z',
      }),
    ).toEqual({
      data: {
        applicationId: 'a1',
        linkId: 'l1',
        actorUserId: 'u1',
        status: 'applied',
        statusChangedAt: '2026-09-22T12:00:00.000Z',
      },
      jobId: 'notify:asn:a1_applied_union_2026-09-22T120000.000Z',
    });
    expect(
      outboxRouteOf(SEARCH_UPSERT_EVENT_TYPE)?.job({
        docType: 'job_preview',
        aggregateId: 'l1',
        reason: 'preview_updated',
        contentHash: 'abcdef0123456789',
      }),
    ).toEqual({
      data: {
        docType: 'job_preview',
        aggregateId: 'l1',
        reason: 'preview_updated',
        contentHash: 'abcdef0123456789',
      },
      jobId: 'search:job_preview_l1:abcdef0123456789',
    });
    expect(
      outboxRouteOf(SEARCH_DELETE_EVENT_TYPE)?.job({
        docType: 'cv',
        aggregateId: 'c1',
        reason: 'aggregate_deleted',
      }),
    ).toEqual({
      data: {
        docType: 'cv',
        aggregateId: 'c1',
        reason: 'aggregate_deleted',
      },
      jobId: 'search:cv_c1:del',
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
    expect(() =>
      outboxRouteOf(MATCH_REQUESTED_EVENT_TYPE)?.job({
        analysisId: 'a1',
        userId: 'u1',
        linkId: 'l1',
      }),
    ).toThrow();
    expect(() =>
      outboxRouteOf(ROADMAP_REQUESTED_EVENT_TYPE)?.job({ analysisId: 'a1' }),
    ).toThrow();
    expect(() =>
      outboxRouteOf(GROUP_LINK_ADDED_EVENT_TYPE)?.job({ groupId: 'g1' }),
    ).toThrow();
  });

  it('does not know an unknown type, nor anything inherited from Object', () => {
    expect(outboxRouteOf('Whatever.v9')).toBeUndefined();
    expect(outboxRouteOf('toString')).toBeUndefined();
  });
});

describe('the jobId of every route, against the rules of BullMQ', () => {
  /** Un payload plausible por tipo: lo que importa es la **forma** del `jobId`, no su contenido. */
  const payloads: Readonly<Record<string, Record<string, unknown>>> = {
    [LINK_CREATED_EVENT_TYPE]: { linkId: 'l1', previewVersion: 1 },
    [CV_UPLOADED_EVENT_TYPE]: { cvId: 'c1', userId: 'u1' },
    [CV_DELETED_EVENT_TYPE]: { cvId: 'c1', userId: 'u1' },
    [MATCH_REQUESTED_EVENT_TYPE]: {
      analysisId: 'a1',
      userId: 'u1',
      linkId: 'l1',
      cvId: 'c1',
    },
    [ROADMAP_REQUESTED_EVENT_TYPE]: {
      analysisId: 'a1',
      userId: 'u1',
    },
    [GROUP_LINK_ADDED_EVENT_TYPE]: {
      groupId: 'g1',
      linkId: 'l1',
      actorUserId: 'u1',
    },
    [APPLICATION_STATUS_NOTIFY_EVENT_TYPE]: {
      applicationId: 'a1',
      linkId: 'l1',
      actorUserId: 'u1',
      status: 'applied',
      statusChangedAt: '2026-09-22T12:00:00.000Z',
    },
    [SEARCH_UPSERT_EVENT_TYPE]: {
      docType: 'job_preview',
      aggregateId: 'l1',
      reason: 'preview_updated',
      contentHash: 'abcdef0123456789',
    },
    [SEARCH_DELETE_EVENT_TYPE]: {
      docType: 'cv',
      aggregateId: 'c1',
      reason: 'aggregate_deleted',
    },
  };

  it('covers every route, so a new event cannot slip past this check', () => {
    expect(Object.keys(payloads).sort()).toEqual(
      Object.keys(OUTBOX_ROUTES).sort(),
    );
  });

  function jobIdOf(type: string): string {
    const payload = payloads[type];
    expect(payload, `missing payload for outbox route ${type}`).toBeDefined();
    const route = OUTBOX_ROUTES[type];
    expect(route, `missing outbox route ${type}`).toBeDefined();
    return route!.job(payload!).jobId;
  }

  it.each(Object.keys(OUTBOX_ROUTES))(
    '%s: with a colon, it has exactly three segments',
    (type) => {
      const jobId = jobIdOf(type);
      // `Job.addJob`: `jobId.includes(':') && jobId.split(':').length !== 3` → `Custom Id cannot contain :`.
      if (jobId.includes(':')) {
        expect(jobId.split(':')).toHaveLength(3);
      }
    },
  );

  it.each(Object.keys(OUTBOX_ROUTES))(
    '%s: does not end with a colon',
    (type) => {
      expect(jobIdOf(type).endsWith(':')).toBe(false);
    },
  );

  it.each(Object.keys(OUTBOX_ROUTES))(
    '%s: is not empty',
    (type) => {
      expect(jobIdOf(type).length).toBeGreaterThan(0);
    },
  );

  it('is stable for the same payload', () => {
    for (const type of Object.keys(OUTBOX_ROUTES)) {
      const jobId = jobIdOf(type);
      expect(OUTBOX_ROUTES[type]?.job(payloads[type]!).jobId).toBe(jobId);
    }
  });
});
