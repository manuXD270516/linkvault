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

  it('openOnly excludes closed previews and keeps open ones', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:open',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest abierto',
        linkId: 'l-open',
        // abierto: sin clave closedAt
      },
      {
        id: 'job_preview:open-null',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest null',
        linkId: 'l-open-null',
        closedAt: null,
      },
      {
        id: 'job_preview:closed',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest cerrado',
        linkId: 'l-closed',
        closedAt: '2026-09-01T12:00:00.000Z',
      },
    ]);
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    const withOpenOnly = await useCase.execute('ana', {
      q: 'Nest',
      openOnly: true,
    });
    expect(withOpenOnly.hits.map((h) => h.id).sort()).toEqual([
      'job_preview:open',
      'job_preview:open-null',
    ]);
    expect(meili.searchCalls[0]?.filter).toContain('closedAt IS NULL');

    const without = await useCase.execute('ana', { q: 'Nest' });
    expect(without.hits.map((h) => h.id).sort()).toEqual([
      'job_preview:closed',
      'job_preview:open',
      'job_preview:open-null',
    ]);

    const withFalse = await useCase.execute('ana', {
      q: 'Nest',
      openOnly: false,
    });
    expect(withFalse.hits.map((h) => h.id).sort()).toEqual([
      'job_preview:closed',
      'job_preview:open',
      'job_preview:open-null',
    ]);
    expect(meili.searchCalls[2]?.filter).not.toContain('closedAt');
  });

  it('rejects empty query even when openOnly is true', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    await expect(
      useCase.execute('ana', { q: '  ', openOnly: true }),
    ).rejects.toBeInstanceOf(EmptySearchQuery);
    expect(meili.searchCalls).toHaveLength(0);
  });

  it('applies D1 salary overlap for full range and excludes low max', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:overlap',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest salario',
        linkId: 'l-overlap',
        salaryMin: 3000,
        salaryMax: 5000,
      },
      {
        id: 'job_preview:low',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest salario',
        linkId: 'l-low',
        salaryMax: 2000,
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
      docType: 'job_preview',
      minSalary: 4000,
      maxSalary: 6000,
    });
    expect(result.hits.map((h) => h.id)).toEqual(['job_preview:overlap']);
    expect(meili.searchCalls[0]?.filter).toContain(
      '((salaryMax >= 4000) OR (salaryMax IS NULL AND salaryMin >= 4000))',
    );
    expect(meili.searchCalls[0]?.filter).toContain(
      '((salaryMin <= 6000) OR (salaryMin IS NULL AND salaryMax <= 6000))',
    );
  });

  it('includes docs with only salaryMin via minSalary proxy', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:min-only',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest min',
        linkId: 'l-min',
        salaryMin: 4500,
        salaryMax: null,
      },
      {
        id: 'job_preview:min-low',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest min',
        linkId: 'l-min-low',
        salaryMin: 3000,
        salaryMax: null,
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
      minSalary: 4000,
    });
    expect(result.hits.map((h) => h.id)).toEqual(['job_preview:min-only']);
  });

  it('includes docs with only salaryMax via maxSalary proxy', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:max-only',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest max',
        linkId: 'l-max',
        salaryMin: null,
        salaryMax: 3500,
      },
      {
        id: 'job_preview:max-high',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest max',
        linkId: 'l-max-high',
        salaryMin: null,
        salaryMax: 8000,
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
      maxSalary: 4000,
    });
    expect(result.hits.map((h) => h.id)).toEqual(['job_preview:max-only']);
  });

  it('excludes docs without numeric salary when range filter is set', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:no-salary',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest sin salario',
        linkId: 'l-none',
      },
      {
        id: 'job_preview:with-salary',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest con salario',
        linkId: 'l-with',
        salaryMin: 2000,
        salaryMax: 4000,
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
      minSalary: 1000,
    });
    expect(result.hits.map((h) => h.id)).toEqual(['job_preview:with-salary']);
  });

  it('rejects empty query even when minSalary is set', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const useCase = new SearchContent(
      config(),
      meili,
      membership,
      createStubEmbedTexts(),
    );
    await expect(
      useCase.execute('ana', { q: '', minSalary: 3000 }),
    ).rejects.toBeInstanceOf(EmptySearchQuery);
    expect(meili.searchCalls).toHaveLength(0);
  });
});
