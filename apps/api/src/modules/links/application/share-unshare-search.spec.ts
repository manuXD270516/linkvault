import {
  SEARCH_DELETE_EVENT_TYPE,
  SEARCH_UPSERT_EVENT_TYPE,
  searchDocumentId,
  type SearchUpsertPayload,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  createSearchContentForTests,
  createSearchFacadeForTests,
  type SearchIndexDocument,
  type SearchMembership,
} from '../../search/application/testing/search-test-doubles';
import { RemoveGroupLink } from './remove-group-link.usecase';
import { SaveLink } from './save-link.usecase';
import {
  ANA,
  BACKEND,
  BETO,
  CommentsHarness,
  STRANGER,
} from './testing/comments-test-harness';
import { InMemoryOutbox } from './testing/links-test-doubles';

/**
 * D12 (tasks 5.2 / 9.1): share → SearchUpsert → miembro ve hit; unshare → recalc/delete → hit desaparece.
 * Simula relay+worker con InMemoryMeili (sin Redis/Meili real).
 */

const fakeSession = {
  startSession: async () => ({
    withTransaction: async (fn: () => Promise<void>) => fn(),
    endSession: async () => undefined,
  }),
} as never;

async function applyOutboxToMeili(
  meili: {
    upsert: (docs: readonly SearchIndexDocument[]) => Promise<void>;
    delete: (ids: readonly string[]) => Promise<void>;
  },
  events: readonly { type: string; payload: unknown }[],
  load: (docType: string, aggregateId: string) => SearchIndexDocument | null,
): Promise<void> {
  for (const event of events) {
    const payload = event.payload as {
      docType: string;
      aggregateId: string;
    };
    if (event.type === SEARCH_DELETE_EVENT_TYPE) {
      await meili.delete([
        searchDocumentId(
          payload.docType as 'job_preview',
          payload.aggregateId,
        ),
      ]);
      continue;
    }
    if (event.type === SEARCH_UPSERT_EVENT_TYPE) {
      const doc = load(payload.docType, payload.aggregateId);
      if (doc === null) {
        await meili.delete([
          searchDocumentId(
            payload.docType as 'job_preview',
            payload.aggregateId,
          ),
        ]);
      } else {
        await meili.upsert([doc]);
      }
    }
  }
}

describe('D12 share/unshare search visibility', () => {
  it('FEATURE_SEARCH on: share → member hit; unshare → hit gone for member', async () => {
    const harness = new CommentsHarness();
    const outbox = new InMemoryOutbox();
    const { facade, meili } = createSearchFacadeForTests(outbox, true);

    const save = new SaveLink(
      harness.links,
      harness.groupLinks,
      harness.userLinks,
      outbox,
      harness.membership,
      harness.directory,
      harness.urls,
      harness.clock,
      facade,
    );
    const remove = new RemoveGroupLink(
      harness.groupLinks,
      harness.membership,
      fakeSession,
      facade,
    );

    const shared = await save.execute(ANA, {
      url: 'https://www.linkedin.com/jobs/view/3811111111/',
      groupId: BACKEND,
    });
    const linkId = shared.link.id;

    const searchEvents = outbox.appended.filter(
      (e) =>
        e.type === SEARCH_UPSERT_EVENT_TYPE ||
        e.type === SEARCH_DELETE_EVENT_TYPE,
    );
    expect(
      searchEvents.some(
        (e) =>
          e.type === SEARCH_UPSERT_EVENT_TYPE &&
          (e.payload as SearchUpsertPayload).docType === 'job_preview' &&
          (e.payload as SearchUpsertPayload).reason === 'group_link_shared',
      ),
    ).toBe(true);

    const loadShared = (
      docType: string,
      aggregateId: string,
    ): SearchIndexDocument | null => {
      if (docType !== 'job_preview' || aggregateId !== linkId) return null;
      return {
        id: searchDocumentId('job_preview', linkId),
        docType: 'job_preview',
        ownerUserId: ANA,
        groupIds: [BACKEND],
        visibilityScope: 'owner_and_groups',
        updatedAt: Date.now(),
        embeddingStatus: 'missing',
        title: 'Backend Engineer remoto Nest',
        linkId,
      };
    };

    await applyOutboxToMeili(meili, searchEvents, loadShared);

    const membership: SearchMembership = {
      groupIdsOf: async (userId) => {
        if (userId === BETO || userId === ANA) return [BACKEND];
        return [];
      },
    };
    const search = createSearchContentForTests(meili, membership);

    const betoHits = await search.execute(BETO, {
      q: 'remoto Nest',
      docType: 'job_preview',
    });
    expect(betoHits.hits.some((h) => h.linkId === linkId)).toBe(true);

    const strangerHits = await search.execute(STRANGER, {
      q: 'remoto Nest',
      docType: 'job_preview',
    });
    expect(strangerHits.hits).toHaveLength(0);

    const beforeUnshare = outbox.size;
    await remove.execute(ANA, BACKEND, linkId);
    const unshareEvents = outbox.appended.slice(beforeUnshare);
    expect(unshareEvents.length).toBeGreaterThan(0);

    const loadUnshared = (
      docType: string,
      aggregateId: string,
    ): SearchIndexDocument | null => {
      if (docType !== 'job_preview' || aggregateId !== linkId) return null;
      return {
        id: searchDocumentId('job_preview', linkId),
        docType: 'job_preview',
        ownerUserId: ANA,
        groupIds: [],
        visibilityScope: 'owner',
        updatedAt: Date.now(),
        embeddingStatus: 'missing',
        title: 'Backend Engineer remoto Nest',
        linkId,
      };
    };

    await applyOutboxToMeili(meili, unshareEvents, loadUnshared);

    const betoAfter = await search.execute(BETO, {
      q: 'remoto Nest',
      docType: 'job_preview',
    });
    expect(betoAfter.hits).toHaveLength(0);

    const anaAfter = await search.execute(ANA, {
      q: 'remoto Nest',
      docType: 'job_preview',
    });
    expect(anaAfter.hits.some((h) => h.linkId === linkId)).toBe(true);
  });

  it('FEATURE_SEARCH off: share writes zero Search* outbox rows', async () => {
    const harness = new CommentsHarness();
    const outbox = new InMemoryOutbox();
    const { facade } = createSearchFacadeForTests(outbox, false);
    const save = new SaveLink(
      harness.links,
      harness.groupLinks,
      harness.userLinks,
      outbox,
      harness.membership,
      harness.directory,
      harness.urls,
      harness.clock,
      facade,
    );
    await save.execute(ANA, {
      url: 'https://www.linkedin.com/jobs/view/3811111111/',
      groupId: BACKEND,
    });
    expect(
      outbox.appended.filter(
        (e) =>
          e.type === SEARCH_UPSERT_EVENT_TYPE ||
          e.type === SEARCH_DELETE_EVENT_TYPE,
      ),
    ).toHaveLength(0);
  });
});
