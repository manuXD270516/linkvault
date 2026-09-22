import { z } from 'zod';
import { searchDocTypeSchema } from '../schemas/search.schema';
import { sha256Hex } from '../text/sha256';

// Indexación / borrado de búsqueda (change search, ADR-009, D4 / C9).
// `api` escribe el evento en la misma txn que el agregado **solo si FEATURE_SEARCH=true**;
// el relay publica en `search-index`; el worker recalcula ACL desde Mongo.
//
// Payload mínimo: docType + aggregateId + reason + contentHash. El jobId colapsa ráfagas
// con el mismo contenido canónico. BullMQ exige exactamente 3 segmentos si hay `:`.

/** Cola BullMQ de indexación / borrado de búsqueda. */
export const SEARCH_INDEX_QUEUE = 'search-index';

/** Tipo versionado de upsert. */
export const SEARCH_UPSERT_EVENT_TYPE = 'SearchUpsert.v1';

/** Tipo versionado de borrado. */
export const SEARCH_DELETE_EVENT_TYPE = 'SearchDelete.v1';

/** Motivos estables de emisión (observabilidad; no cambian el contrato del consumer). */
export const SEARCH_UPSERT_REASONS = [
  'preview_created',
  'preview_updated',
  'application_upsert',
  'comment_upsert',
  'note_upsert',
  'cv_upsert',
  'roadmap_upsert',
  'group_link_shared',
  'group_link_unshared',
  'group_deleted',
  'backfill',
  'reembed',
] as const;
export const searchUpsertReasonSchema = z.enum(SEARCH_UPSERT_REASONS);
export type SearchUpsertReason = z.infer<typeof searchUpsertReasonSchema>;

export const SEARCH_DELETE_REASONS = [
  'aggregate_deleted',
  'group_link_removed',
  'group_deleted',
  'account_deleted',
] as const;
export const searchDeleteReasonSchema = z.enum(SEARCH_DELETE_REASONS);
export type SearchDeleteReason = z.infer<typeof searchDeleteReasonSchema>;

/** Payload de upsert: identificadores + hash de contenido canónico. */
export const searchUpsertPayloadSchema = z.strictObject({
  docType: searchDocTypeSchema,
  aggregateId: z.string().min(1),
  reason: searchUpsertReasonSchema,
  /** Hex corto del fingerprint canónico (searchable + ACL + ids). */
  contentHash: z.string().min(8).max(64),
});
export type SearchUpsertPayload = z.infer<typeof searchUpsertPayloadSchema>;

export const searchUpsertEventSchema = z.strictObject({
  type: z.literal(SEARCH_UPSERT_EVENT_TYPE),
  payload: searchUpsertPayloadSchema,
});
export type SearchUpsertEvent = z.infer<typeof searchUpsertEventSchema>;

export function searchUpsertEvent(
  payload: SearchUpsertPayload,
): SearchUpsertEvent {
  return { type: SEARCH_UPSERT_EVENT_TYPE, payload };
}

/**
 * jobId determinista: `search:{docType}_{aggregateId}:{contentHash}` (3 segmentos BullMQ).
 * Mismo contenido → mismo jobId → colapsa ráfagas; cambio de texto/ACL → hash nuevo.
 */
export function searchUpsertJobId(payload: SearchUpsertPayload): string {
  return `search:${payload.docType}_${payload.aggregateId}:${payload.contentHash}`;
}

/** Payload de delete. */
export const searchDeletePayloadSchema = z.strictObject({
  docType: searchDocTypeSchema,
  aggregateId: z.string().min(1),
  reason: searchDeleteReasonSchema,
});
export type SearchDeletePayload = z.infer<typeof searchDeletePayloadSchema>;

export const searchDeleteEventSchema = z.strictObject({
  type: z.literal(SEARCH_DELETE_EVENT_TYPE),
  payload: searchDeletePayloadSchema,
});
export type SearchDeleteEvent = z.infer<typeof searchDeleteEventSchema>;

export function searchDeleteEvent(
  payload: SearchDeletePayload,
): SearchDeleteEvent {
  return { type: SEARCH_DELETE_EVENT_TYPE, payload };
}

/**
 * jobId de delete: `search:{docType}_{aggregateId}:del` — idempotente por agregado.
 */
export function searchDeleteJobId(payload: SearchDeletePayload): string {
  return `search:${payload.docType}_${payload.aggregateId}:del`;
}

/**
 * Hash corto del fingerprint canónico (campos searchable + ACL materializados + ids).
 * El emisor construye el fingerprint; el worker no confía en él para el documento Meili.
 * Sin `node:crypto`: shared es `platform:any` y el SPA importa el barrel.
 */
export function searchContentHash(fingerprint: string): string {
  return sha256Hex(fingerprint).slice(0, 16);
}

/** Primary key Meili estable: `{docType}:{aggregateId}`. */
export function searchDocumentId(
  docType: z.infer<typeof searchDocTypeSchema>,
  aggregateId: string,
): string {
  return `${docType}:${aggregateId}`;
}
