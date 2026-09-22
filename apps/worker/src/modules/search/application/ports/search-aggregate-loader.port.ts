import type { SearchDocType } from '@linkvault/shared';
import type { SearchIndexDocument } from './meili-search-client.port';

export const SEARCH_AGGREGATE_LOADER = Symbol('SEARCH_AGGREGATE_LOADER');

/**
 * Carga el agregado desde Mongo y materializa el documento de índice con ACL
 * recalculada (groupIds / visibilityScope). `null` → delete en Meili.
 */
export interface SearchAggregateLoader {
  load(
    docType: SearchDocType,
    aggregateId: string,
  ): Promise<SearchIndexDocument | null>;
}
