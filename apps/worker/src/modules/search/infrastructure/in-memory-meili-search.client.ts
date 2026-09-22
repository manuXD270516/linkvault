import type {
  MeiliSearchClient,
  MeiliSearchHit,
  MeiliSearchQuery,
  MeiliSearchResult,
  SearchIndexDocument,
} from '../application/ports/meili-search-client.port';

export class InMemoryMeiliSearchClient implements MeiliSearchClient {
  readonly configured: boolean;
  readonly documents = new Map<string, SearchIndexDocument>();
  healthyFlag = true;
  failNextWrite = false;

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
    for (const id of ids) {
      this.documents.delete(id);
    }
    return Promise.resolve();
  }

  deleteByFilter(filter: string): Promise<void> {
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
    const q = query.q.trim().toLowerCase();
    const matched = [...this.documents.values()].filter((doc) => {
      const hay = [doc.title, doc.body, doc.note, doc.text, doc.description]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      return q.length > 0 && hay.includes(q);
    });
    const hits: MeiliSearchHit[] = matched
      .slice(query.offset, query.offset + query.limit)
      .map((doc) => ({
        id: doc.id,
        docType: doc.docType,
        score: 1,
        ...(doc.title === undefined ? {} : { title: doc.title }),
      }));
    return Promise.resolve({ hits, estimatedTotal: matched.length });
  }
}
