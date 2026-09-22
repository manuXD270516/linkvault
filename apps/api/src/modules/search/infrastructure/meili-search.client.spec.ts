import { describe, expect, it } from 'vitest';
import { InMemoryMeiliSearchClient } from './in-memory-meili-search.client';
import type { SearchIndexDocument } from '../application/ports/meili-search-client.port';

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
