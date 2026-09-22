import type {
  SearchDeletePayload,
  SearchUpsertPayload,
} from '@linkvault/shared';
import {
  SEARCH_INDEX_QUEUE,
  searchContentHash,
  searchDeleteJobId,
  searchUpsertJobId,
} from '@linkvault/shared';

/**
 * Publica jobs de indexación/borrado en `search-index` desde el worker (CV extract, roadmap ready).
 * Sin outbox en el proceso worker: mismo patrón que RoadmapJobPublisher (opción A).
 * FEATURE_SEARCH=false → no-op en la implementación concreta.
 */
export const SEARCH_INDEX_JOB_PUBLISHER = Symbol('SEARCH_INDEX_JOB_PUBLISHER');

export interface SearchIndexJobPublisher {
  upsert(input: {
    readonly docType: SearchUpsertPayload['docType'];
    readonly aggregateId: string;
    readonly reason: SearchUpsertPayload['reason'];
    readonly fingerprint: string;
  }): Promise<void>;

  delete(input: {
    readonly docType: SearchDeletePayload['docType'];
    readonly aggregateId: string;
    readonly reason: SearchDeletePayload['reason'];
  }): Promise<void>;
}

export function toSearchUpsertJob(input: {
  readonly docType: SearchUpsertPayload['docType'];
  readonly aggregateId: string;
  readonly reason: SearchUpsertPayload['reason'];
  readonly fingerprint: string;
}): { readonly payload: SearchUpsertPayload; readonly jobId: string } {
  const payload: SearchUpsertPayload = {
    docType: input.docType,
    aggregateId: input.aggregateId,
    reason: input.reason,
    contentHash: searchContentHash(input.fingerprint),
  };
  return { payload, jobId: searchUpsertJobId(payload) };
}

export function toSearchDeleteJob(input: {
  readonly docType: SearchDeletePayload['docType'];
  readonly aggregateId: string;
  readonly reason: SearchDeletePayload['reason'];
}): { readonly payload: SearchDeletePayload; readonly jobId: string } {
  const payload: SearchDeletePayload = {
    docType: input.docType,
    aggregateId: input.aggregateId,
    reason: input.reason,
  };
  return { payload, jobId: searchDeleteJobId(payload) };
}

export { SEARCH_INDEX_QUEUE };
