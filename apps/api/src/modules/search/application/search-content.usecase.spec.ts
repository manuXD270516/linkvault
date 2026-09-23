import { describe, expect, it } from 'vitest';
import { InMemoryMeiliSearchClient } from '../infrastructure/in-memory-meili-search.client';
import { createStubEmbedTexts } from '../infrastructure/stub-embed-texts';
import type { SearchMembership } from './ports/search-membership.port';
import { SearchContent } from './search-content.usecase';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { EmptySearchQuery, SearchUnavailable } from '../domain/errors';

function config(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    FEATURE_SEARCH: true,
    MEILI_HOST: 'http://localhost:7700',
    MEILI_MASTER_KEY: 'k',
    MEILI_INDEX: 'lv_content',
    SEARCH_SEMANTIC_RATIO: 0.5,
    SEARCH_BACKFILL_RATE: 5,
    ...overrides,
  } as ApiConfig;
}

const membership: SearchMembership = {
  groupIdsOf: async (userId) => (userId === 'ana' ? ['g1'] : ['g2']),
};

describe('SearchContent', () => {
  it('rejects empty query with empty_query', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    await expect(useCase.execute('ana', { q: '   ' })).rejects.toBeInstanceOf(
      EmptySearchQuery,
    );
  });

  it('returns 503 semantics when FEATURE_SEARCH=false', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const useCase = new SearchContent(
      config({ FEATURE_SEARCH: false }),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    await expect(
      useCase.execute('ana', { q: 'remoto' }),
    ).rejects.toBeInstanceOf(SearchUnavailable);
  });

  it('clamps limit to 50', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:l1',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'remoto Nest',
        linkId: 'l1',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const result = await useCase.execute('ana', { q: 'remoto', limit: 999 });
    expect(result.limit).toBe(50);
  });

  it('does not leak another group comment to Ana', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'group_comment:c1',
        docType: 'group_comment',
        ownerUserId: 'luis',
        groupIds: ['g2'],
        visibilityScope: 'group',
        updatedAt: 1,
        embeddingStatus: 'missing',
        body: 'secreto del grupo B',
        groupId: 'g2',
        linkId: 'l9',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const result = await useCase.execute('ana', { q: 'secreto' });
    expect(result.hits).toHaveLength(0);
  });

  it('never returns another user cv', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'cv:c1',
        docType: 'cv',
        ownerUserId: 'luis',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        text: 'fragmento unico del cv de luis',
        cvId: 'c1',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const result = await useCase.execute('ana', {
      q: 'fragmento unico',
      docType: 'cv',
    });
    expect(result.hits).toHaveLength(0);
  });

  it('degrades to fulltext when embed fails', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:l1',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'remoto Nest',
        linkId: 'l1',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts({ fail: true }),
    );
    const result = await useCase.execute('ana', { q: 'remoto', mode: 'hybrid' });
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe('embeddings_unavailable');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(meili.searchCalls[0]?.mode).toBe('fulltext');
  });

  it('throws SearchUnavailable when Meili is unhealthy', async () => {
    const meili = new InMemoryMeiliSearchClient();
    meili.healthyFlag = false;
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    await expect(
      useCase.execute('ana', { q: 'remoto' }),
    ).rejects.toBeInstanceOf(SearchUnavailable);
  });

  it('rejects empty query even when LatAm filters are present', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    await expect(
      useCase.execute('ana', { q: '  ', modality: 'remote' }),
    ).rejects.toBeInstanceOf(EmptySearchQuery);
  });

  it('filters by modality', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:l1',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'dev Nest',
        modality: 'remote',
        linkId: 'l1',
      },
      {
        id: 'job_preview:l2',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'dev Nest',
        modality: 'onsite',
        linkId: 'l2',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const result = await useCase.execute('ana', {
      q: 'Nest',
      modality: 'remote',
    });
    expect(result.hits.map((h) => h.id)).toEqual(['job_preview:l1']);
    expect(meili.searchCalls[0]?.filter).toContain('modality = "remote"');
  });

  it('maps applicationStatus to Meili status filter', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'application:a1',
        docType: 'application',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'postulacion Nest',
        status: 'applied',
        applicationId: 'a1',
        linkId: 'l1',
      },
      {
        id: 'application:a2',
        docType: 'application',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'postulacion Nest',
        status: 'interested',
        applicationId: 'a2',
        linkId: 'l2',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const result = await useCase.execute('ana', {
      q: 'Nest',
      applicationStatus: 'applied',
    });
    expect(result.hits.map((h) => h.id)).toEqual(['application:a1']);
    expect(meili.searchCalls[0]?.filter).toContain('status = "applied"');
    expect(meili.searchCalls[0]?.filter).not.toContain('applicationStatus');
  });

  it('filters by salaryCurrency', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:l1',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'salario Nest',
        salaryCurrency: 'USD',
        linkId: 'l1',
      },
      {
        id: 'job_preview:l2',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'salario Nest',
        salaryCurrency: 'BOB',
        linkId: 'l2',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const result = await useCase.execute('ana', {
      q: 'Nest',
      salaryCurrency: 'USD',
    });
    expect(result.hits.map((h) => h.id)).toEqual(['job_preview:l1']);
    expect(meili.searchCalls[0]?.filter).toContain('salaryCurrency = "USD"');
  });

  it('does not leak another user application via applicationStatus filter', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'application:a9',
        docType: 'application',
        ownerUserId: 'luis',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'secreto applied Nest',
        status: 'applied',
        applicationId: 'a9',
        linkId: 'l9',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const result = await useCase.execute('ana', {
      q: 'Nest',
      applicationStatus: 'applied',
    });
    expect(result.hits).toHaveLength(0);
    expect(meili.searchCalls[0]?.filter).toContain('ownerUserId = "ana"');
    expect(meili.searchCalls[0]?.filter).toContain('status = "applied"');
  });
});
