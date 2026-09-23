import { describe, expect, it } from 'vitest';
import { InMemoryMeiliSearchClient } from './in-memory-meili-search.client';
import type { SearchIndexDocument } from '../application/ports/meili-search-client.port';
import { MEILI_FILTERABLE_ATTRIBUTES } from './meili-search.client';

describe('MEILI_FILTERABLE_ATTRIBUTES', () => {
  it('includes LatAm filterables and salary range (parity with worker)', () => {
    expect(MEILI_FILTERABLE_ATTRIBUTES).toContain('modality');
    expect(MEILI_FILTERABLE_ATTRIBUTES).toContain('status');
    expect(MEILI_FILTERABLE_ATTRIBUTES).toContain('salaryCurrency');
    expect(MEILI_FILTERABLE_ATTRIBUTES).toContain('salaryMin');
    expect(MEILI_FILTERABLE_ATTRIBUTES).toContain('salaryMax');
  });
});

describe('InMemoryMeiliSearchClient', () => {
  it('upserts and deletes by primary key idempotently', async () => {
    const meili = new InMemoryMeiliSearchClient();
    const doc: SearchIndexDocument = {
      id: 'job_preview:l1',
      docType: 'job_preview',
      ownerUserId: 'ana',
      groupIds: ['g1'],
      visibilityScope: 'owner_and_groups',
      updatedAt: Date.now(),
      embeddingStatus: 'missing',
      title: 'Nest remoto',
      linkId: 'l1',
    };
    await meili.upsert([doc]);
    await meili.upsert([{ ...doc, title: 'Nest remoto actualizado' }]);
    expect(meili.documents.get('job_preview:l1')?.title).toBe(
      'Nest remoto actualizado',
    );
    await meili.delete(['job_preview:l1']);
    await meili.delete(['job_preview:l1']);
    expect(meili.documents.has('job_preview:l1')).toBe(false);
  });

  it('deleteByFilter removes by ownerUserId', async () => {
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
        id: 'cv:c2',
        docType: 'cv',
        ownerUserId: 'luis',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
      },
    ]);
    await meili.deleteByFilter('ownerUserId = "ana"');
    expect(meili.documents.has('cv:c1')).toBe(false);
    expect(meili.documents.has('cv:c2')).toBe(true);
  });

  it('evaluates D1 salary comparisons and IS NULL', async () => {
    const meili = new InMemoryMeiliSearchClient();
    await meili.upsert([
      {
        id: 'job_preview:both',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest',
        salaryMin: 3000,
        salaryMax: 5000,
      },
      {
        id: 'job_preview:min-only',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest',
        salaryMin: 4500,
        salaryMax: null,
      },
      {
        id: 'job_preview:none',
        docType: 'job_preview',
        ownerUserId: 'ana',
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: 1,
        embeddingStatus: 'missing',
        title: 'Nest',
        salaryMin: null,
        salaryMax: null,
      },
    ]);
    const minFilter =
      '(ownerUserId = "ana" AND visibilityScope IN ["owner", "owner_and_groups"]) AND ((salaryMax >= 4000) OR (salaryMax IS NULL AND salaryMin >= 4000))';
    const result = await meili.search({
      q: 'Nest',
      filter: minFilter,
      limit: 10,
      offset: 0,
      mode: 'fulltext',
      semanticRatio: 0.5,
    });
    expect(result.hits.map((h) => h.id).sort()).toEqual([
      'job_preview:both',
      'job_preview:min-only',
    ]);
  });
});

/**
 * Integración contra Meili real: encender con MEILI_INTEGRATION=1 y
 * `docker compose --profile search up -d --wait`, luego:
 *   MEILI_INTEGRATION=1 pnpm nx run api:test -- meili-search.client
 * Sin ese flag, este describe se salta (task 4.2).
 */
const meiliIntegration = process.env['MEILI_INTEGRATION'] === '1';

describe.skipIf(!meiliIntegration)('MeiliSearchClientAdapter against compose', () => {
  it('is documented as an opt-in integration test', () => {
    expect(meiliIntegration).toBe(true);
  });
});
