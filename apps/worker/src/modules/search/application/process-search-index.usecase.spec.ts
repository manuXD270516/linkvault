import { describe, expect, it } from 'vitest';
import type { WorkerConfig } from '../../../infrastructure/config/worker-config.schema';
import { InMemoryMeiliSearchClient } from '../infrastructure/in-memory-meili-search.client';
import { createStubEmbedTexts } from '../infrastructure/stub-embed-texts';
import type { SearchIndexDocument } from './ports/meili-search-client.port';
import type { SearchAggregateLoader } from './ports/search-aggregate-loader.port';
import { ProcessSearchIndex } from './process-search-index.usecase';

function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    FEATURE_SEARCH: true,
    MEILI_HOST: 'http://localhost:7700',
    MEILI_MASTER_KEY: 'k',
    MEILI_INDEX: 'lv_content',
    SEARCH_SEMANTIC_RATIO: 0.5,
    SEARCH_BACKFILL_RATE: 5,
    ...overrides,
  } as WorkerConfig;
}

describe('ProcessSearchIndex', () => {
  it('acks no-op when FEATURE_SEARCH=false', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const loader: SearchAggregateLoader = {
      load: async () => {
        throw new Error('should not load');
      },
    };
    const useCase = new ProcessSearchIndex(
      config({ FEATURE_SEARCH: false }),
      meili,
      loader,
      createStubEmbedTexts(),
    );
    await useCase.executePayload({
      docType: 'job_preview',
      aggregateId: 'l1',
      reason: 'preview_updated',
      contentHash: 'abcdef0123456789',
    });
    expect(meili.documents.size).toBe(0);
  });

  it('acks no-op when Meili is not configured', async () => {
    const meili = new InMemoryMeiliSearchClient(false);
    const useCase = new ProcessSearchIndex(
      config(),
      meili,
      {
        load: async () => null,
      },
      createStubEmbedTexts(),
    );
    await useCase.executePayload({
      docType: 'cv',
      aggregateId: 'c1',
      reason: 'cv_upsert',
      contentHash: 'abcdef0123456789',
    });
    expect(meili.documents.size).toBe(0);
  });

  it('upserts with ACL from loader and embedding metadata', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const doc: SearchIndexDocument = {
      id: 'job_preview:l1',
      docType: 'job_preview',
      ownerUserId: 'ana',
      groupIds: ['g1'],
      visibilityScope: 'owner_and_groups',
      updatedAt: 1,
      embeddingStatus: 'missing',
      title: 'Nest remoto',
      linkId: 'l1',
    };
    const useCase = new ProcessSearchIndex(
      config(),
      meili,
      { load: async () => doc },
      createStubEmbedTexts(),
    );
    await useCase.executePayload({
      docType: 'job_preview',
      aggregateId: 'l1',
      reason: 'group_link_shared',
      contentHash: 'abcdef0123456789',
    });
    const stored = meili.documents.get('job_preview:l1');
    expect(stored?.groupIds).toEqual(['g1']);
    expect(stored?.visibilityScope).toBe('owner_and_groups');
    expect(stored?.embeddingStatus).toBe('ready');
    expect(stored?.embedModelId).toBeDefined();
    expect(stored?._vectors?.default.length).toBeGreaterThan(0);
  });

  it('deletes when aggregate is gone', async () => {
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
    const useCase = new ProcessSearchIndex(
      config(),
      meili,
      { load: async () => null },
      createStubEmbedTexts(),
    );
    await useCase.executePayload({
      docType: 'cv',
      aggregateId: 'c1',
      reason: 'cv_upsert',
      contentHash: 'abcdef0123456789',
    });
    expect(meili.documents.has('cv:c1')).toBe(false);
  });

  it('indexes without vector when embed fails', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const doc: SearchIndexDocument = {
      id: 'job_preview:l1',
      docType: 'job_preview',
      ownerUserId: 'ana',
      groupIds: [],
      visibilityScope: 'owner',
      updatedAt: 1,
      embeddingStatus: 'missing',
      title: 'Nest',
      linkId: 'l1',
    };
    const useCase = new ProcessSearchIndex(
      config(),
      meili,
      { load: async () => doc },
      createStubEmbedTexts({ fail: true }),
    );
    await useCase.executePayload({
      docType: 'job_preview',
      aggregateId: 'l1',
      reason: 'preview_updated',
      contentHash: 'abcdef0123456789',
    });
    expect(meili.documents.get('job_preview:l1')?.embeddingStatus).toBe(
      'failed',
    );
  });
});
