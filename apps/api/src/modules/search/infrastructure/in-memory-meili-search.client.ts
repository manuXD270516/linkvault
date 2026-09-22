import type {
  MeiliSearchClient,
  MeiliSearchHit,
  MeiliSearchQuery,
  MeiliSearchResult,
  SearchIndexDocument,
} from '../application/ports/meili-search-client.port';

// Fake in-memory Meili para tests unitarios (task 4.2 / 5.1). Sin red.

export class InMemoryMeiliSearchClient implements MeiliSearchClient {
  readonly configured: boolean;
  readonly documents = new Map<string, SearchIndexDocument>();
  healthyFlag = true;
  failNextWrite = false;
  deleteByFilterCalls: string[] = [];
  searchCalls: MeiliSearchQuery[] = [];

  constructor(configured = true) {
    this.configured = configured;
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(this.configured && this.healthyFlag);
  }

  ensureIndex(): Promise<void> {
    return Promise.resolve();
  }

  upsert(documents: readonly SearchIndexDocument[]): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error('meili upsert failed'));
    }
    for (const doc of documents) {
      this.documents.set(doc.id, doc);
    }
    return Promise.resolve();
  }

  delete(ids: readonly string[]): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error('meili delete failed'));
    }
    for (const id of ids) {
      this.documents.delete(id);
    }
    return Promise.resolve();
  }

  deleteByFilter(filter: string): Promise<void> {
    this.deleteByFilterCalls.push(filter);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error('meili deleteByFilter failed'));
    }
    if (!this.healthyFlag) {
      return Promise.reject(new Error('meili unavailable'));
    }
    const ownerMatch = /ownerUserId\s*=\s*"([^"]+)"/.exec(filter);
    const groupMatch = /groupIds\s*=\s*"([^"]+)"/.exec(filter);
    for (const [id, doc] of [...this.documents.entries()]) {
      if (ownerMatch !== null && doc.ownerUserId === ownerMatch[1]) {
        this.documents.delete(id);
        continue;
      }
      if (groupMatch !== null && doc.groupIds.includes(groupMatch[1])) {
        this.documents.delete(id);
      }
    }
    return Promise.resolve();
  }

  search(query: MeiliSearchQuery): Promise<MeiliSearchResult> {
    this.searchCalls.push(query);
    if (!this.healthyFlag) {
      return Promise.reject(new Error('meili unavailable'));
    }
    const q = query.q.trim().toLowerCase();
    const all = [...this.documents.values()].filter((doc) =>
      matchesAclFilter(doc, query.filter),
    );
    const matched = all.filter((doc) => {
      if (q.length === 0) return false;
      const hay = [
        doc.title,
        doc.company,
        doc.description,
        doc.body,
        doc.note,
        doc.notes,
        doc.text,
        doc.stepsText,
        ...(doc.skills ?? []),
      ]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
    const page = matched.slice(query.offset, query.offset + query.limit);
    const hits: MeiliSearchHit[] = page.map((doc) => ({
      id: doc.id,
      docType: doc.docType,
      score: 1,
      ...(doc.title === undefined ? {} : { title: doc.title }),
      ...(doc.body === undefined ? {} : { body: doc.body }),
      ...(doc.note === undefined ? {} : { note: doc.note }),
      ...(doc.notes === undefined ? {} : { notes: doc.notes }),
      ...(doc.text === undefined ? {} : { text: doc.text }),
      ...(doc.description === undefined ? {} : { description: doc.description }),
      ...(doc.linkId === undefined ? {} : { linkId: doc.linkId }),
      ...(doc.groupId === undefined ? {} : { groupId: doc.groupId }),
      ...(doc.applicationId === undefined
        ? {}
        : { applicationId: doc.applicationId }),
      ...(doc.cvId === undefined ? {} : { cvId: doc.cvId }),
      ...(doc.roadmapId === undefined ? {} : { roadmapId: doc.roadmapId }),
      ...(doc.analysisId === undefined ? {} : { analysisId: doc.analysisId }),
    }));
    return Promise.resolve({ hits, estimatedTotal: matched.length });
  }
}

function matchesAclFilter(doc: SearchIndexDocument, filter: string): boolean {
  // Filtros simplificados para tests: comprueba ownerUserId y/o groupIds + visibilityScope.
  if (filter.includes(`ownerUserId = "${doc.ownerUserId}"`)) {
    if (
      doc.visibilityScope === 'owner' ||
      doc.visibilityScope === 'owner_and_groups'
    ) {
      return true;
    }
  }
  for (const groupId of doc.groupIds) {
    if (
      filter.includes(`groupIds = "${groupId}"`) &&
      (doc.visibilityScope === 'group' ||
        doc.visibilityScope === 'owner_and_groups')
    ) {
      const groupDocs = ['job_preview', 'group_comment', 'group_link_note'];
      if (groupDocs.includes(doc.docType)) {
        return true;
      }
    }
  }
  return false;
}
