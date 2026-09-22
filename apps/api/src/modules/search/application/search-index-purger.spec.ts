import { describe, expect, it } from 'vitest';
import { SearchIndexPurger } from './search-index-purger';
import { SearchPurgeFailed } from '../domain/errors';
import { InMemoryMeiliSearchClient } from '../infrastructure/in-memory-meili-search.client';
import { createStubEmbedTexts } from '../infrastructure/stub-embed-texts';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { SearchContent } from './search-content.usecase';

describe('SearchIndexPurger', () => {
  it('skips Meili when FEATURE_SEARCH=false', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'cv:c1',
        docType: 'cv',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
      },
    ]);
    const purger = new SearchIndexPurger(
      { FEATURE_SEARCH: false } as ApiConfig,
      meili,
    );
    await purger.purgeUser('ana', []);
    expect(meili.deleteByFilterCalls).toHaveLength(0);
    expect(meili.documents.has('cv:c1')).toBe(true);
  });

  it('throws search_purge_failed when Meili is down and leaves data', async () => {
    const meili = new InMemoryMeiliSearchClient();
    meili.healthyFlag = false;
    await meili.upsert([
      {
        id: 'cv:c1',
        docType: 'cv',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
      },
    ]);
    const purger = new SearchIndexPurger(
      { FEATURE_SEARCH: true } as ApiConfig,
      meili,
    );
    await expect(purger.purgeUser('ana', ['g1'])).rejects.toBeInstanceOf(
      SearchPurgeFailed,
    );
    expect(meili.documents.has('cv:c1')).toBe(true);
  });

  it('purges by owner and group filters when healthy', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'cv:c1',
        docType: 'cv',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
      },
      {
        id: 'group_comment:cm1',
        docType: 'group_comment',
        ownerUserId: 'ana',
        groupIds: ['g1'],
        visibilityScope: 'group',
        updatedAt: 1,
        embeddingStatus: 'missing',
        body: 'hola',
      },
    ]);
    const purger = new SearchIndexPurger(
      { FEATURE_SEARCH: true } as ApiConfig,
      meili,
    );
    await purger.purgeUser('ana', ['g1']);
    expect(meili.documents.size).toBe(0);
    expect(meili.deleteByFilterCalls[0]).toContain('ownerUserId = "ana"');
    expect(meili.deleteByFilterCalls[1]).toContain('groupIds = "g1"');
  });

  it('account-deletion cascade: Luis cannot find Ana comment after purge', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'group_comment:cm-ana',
        docType: 'group_comment',
        ownerUserId: 'ana',
        groupIds: ['g-shared'],
        visibilityScope: 'group',
        updatedAt: 1,
        embeddingStatus: 'missing',
        body: 'comentario unico de ana',
        groupId: 'g-shared',
      },
    ]);
    const purger = new SearchIndexPurger(
      { FEATURE_SEARCH: true } as ApiConfig,
      meili,
    );
    await purger.purgeUser('ana', ['g-shared']);
    expect(meili.documents.has('group_comment:cm-ana')).toBe(false);

    const search = new SearchContent(
      {
        FEATURE_SEARCH: true,
        MEILI_HOST: 'http://localhost:7700',
        MEILI_MASTER_KEY: 'k',
        MEILI_INDEX: 'lv_content',
        SEARCH_SEMANTIC_RATIO: 0.5,
      } as ApiConfig,
      meili,
      { groupIdsOf: async () => ['g-shared'] },
      createStubEmbedTexts(),
    );
    const luis = await search.execute('luis', {
      q: 'comentario unico',
      docType: 'group_comment',
    });
    expect(luis.hits).toHaveLength(0);
  });
});
