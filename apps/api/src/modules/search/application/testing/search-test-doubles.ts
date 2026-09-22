import type { ApiConfig } from '../../../../infrastructure/config/api-config.schema';
import { InMemoryMeiliSearchClient } from '../../infrastructure/in-memory-meili-search.client';
import { createStubEmbedTexts } from '../../infrastructure/stub-embed-texts';
import type { SearchIndexDocument } from '../ports/meili-search-client.port';
import type { SearchMembership } from '../ports/search-membership.port';
import { SearchContent } from '../search-content.usecase';
import { SearchFacade } from '../search.facade';
import { SearchIndexPurger } from '../search-index-purger';
import { SearchOutboxEmitter } from '../search-outbox-emitter';
import type { Outbox } from '../../../../infrastructure/outbox/outbox.port';

/** Dobles públicos de search para tests de otros módulos (lint de límites). */

export { InMemoryMeiliSearchClient };
export { createStubEmbedTexts };
export type { SearchIndexDocument, SearchMembership };

export function createSearchFacadeForTests(
  outbox: Outbox,
  featureSearch: boolean,
  meili: InMemoryMeiliSearchClient = new InMemoryMeiliSearchClient(),
): { readonly facade: SearchFacade; readonly meili: InMemoryMeiliSearchClient } {
  const config = {
    FEATURE_SEARCH: featureSearch,
    MEILI_HOST: 'http://localhost:7700',
    MEILI_MASTER_KEY: 'k',
    MEILI_INDEX: 'lv_content',
    SEARCH_SEMANTIC_RATIO: 0.5,
    SEARCH_BACKFILL_RATE: 5,
  } as ApiConfig;
  const emitter = new SearchOutboxEmitter(outbox, config);
  const purger = new SearchIndexPurger(config, meili);
  return { facade: new SearchFacade(emitter, purger), meili };
}

export function createSearchContentForTests(
  meili: InMemoryMeiliSearchClient,
  membership: SearchMembership,
): SearchContent {
  return new SearchContent(
    {
      FEATURE_SEARCH: true,
      MEILI_HOST: 'http://localhost:7700',
      MEILI_MASTER_KEY: 'k',
      MEILI_INDEX: 'lv_content',
      SEARCH_SEMANTIC_RATIO: 0.5,
    } as ApiConfig,
    meili,
    membership,
    createStubEmbedTexts(),
  );
}
