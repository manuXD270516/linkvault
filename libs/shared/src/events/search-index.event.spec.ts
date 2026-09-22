import { describe, expect, it } from 'vitest';
import {
  SEARCH_DELETE_EVENT_TYPE,
  SEARCH_INDEX_QUEUE,
  SEARCH_UPSERT_EVENT_TYPE,
  searchContentHash,
  searchDeleteEvent,
  searchDeleteJobId,
  searchDeletePayloadSchema,
  searchDocumentId,
  searchUpsertEvent,
  searchUpsertJobId,
  searchUpsertPayloadSchema,
} from './search-index.event';

describe('SearchUpsert.v1 / SearchDelete.v1', () => {
  it('declares the search-index queue and versioned types', () => {
    expect(SEARCH_INDEX_QUEUE).toBe('search-index');
    expect(SEARCH_UPSERT_EVENT_TYPE).toBe('SearchUpsert.v1');
    expect(SEARCH_DELETE_EVENT_TYPE).toBe('SearchDelete.v1');
  });

  it('accepts a minimal upsert payload and builds a 3-segment jobId', () => {
    const hash = searchContentHash('job_preview|l1|title|g1');
    const payload = searchUpsertPayloadSchema.parse({
      docType: 'job_preview',
      aggregateId: 'l1',
      reason: 'preview_updated',
      contentHash: hash,
    });
    const event = searchUpsertEvent(payload);
    expect(event.type).toBe(SEARCH_UPSERT_EVENT_TYPE);
    const jobId = searchUpsertJobId(payload);
    expect(jobId.split(':')).toHaveLength(3);
    expect(jobId).toBe(`search:job_preview_l1:${hash}`);
  });

  it('collapses identical content hashes and diverges when fingerprint changes', () => {
    const a = searchContentHash('same');
    const b = searchContentHash('same');
    const c = searchContentHash('other');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(
      searchUpsertJobId({
        docType: 'cv',
        aggregateId: 'c1',
        reason: 'cv_upsert',
        contentHash: a,
      }),
    ).toBe(
      searchUpsertJobId({
        docType: 'cv',
        aggregateId: 'c1',
        reason: 'backfill',
        contentHash: a,
      }),
    );
  });

  it('accepts a delete payload with a stable del jobId', () => {
    const payload = searchDeletePayloadSchema.parse({
      docType: 'group_comment',
      aggregateId: 'cm1',
      reason: 'aggregate_deleted',
    });
    expect(searchDeleteEvent(payload).type).toBe(SEARCH_DELETE_EVENT_TYPE);
    expect(searchDeleteJobId(payload)).toBe('search:group_comment_cm1:del');
    expect(searchDeleteJobId(payload).split(':')).toHaveLength(3);
  });

  it('builds a stable Meili primary key', () => {
    expect(searchDocumentId('job_preview', 'l1')).toBe('job_preview:l1');
    expect(searchDocumentId('cv', 'c1')).toBe('cv:c1');
  });

  it('rejects unknown docType or missing contentHash', () => {
    expect(() =>
      searchUpsertPayloadSchema.parse({
        docType: 'unknown',
        aggregateId: 'x',
        reason: 'backfill',
        contentHash: 'abcdef0123456789',
      }),
    ).toThrow();
    expect(() =>
      searchUpsertPayloadSchema.parse({
        docType: 'cv',
        aggregateId: 'c1',
        reason: 'cv_upsert',
      }),
    ).toThrow();
  });
});
