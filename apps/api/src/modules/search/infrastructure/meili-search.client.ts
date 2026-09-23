import type { SearchDocType } from '@linkvault/shared';
import { MeiliSearch } from 'meilisearch';
import type {
  MeiliSearchClient,
  MeiliSearchHit,
  MeiliSearchQuery,
  MeiliSearchResult,
  SearchIndexDocument,
} from '../application/ports/meili-search-client.port';

// Adaptador Meilisearch (change search, D2–D3). SDK solo aquí (misma regla de aislamiento que IA).

const FILTERABLE = [
  'id',
  'docType',
  'ownerUserId',
  'groupIds',
  'visibilityScope',
  'updatedAt',
  'embeddingStatus',
  'embedModelId',
  'embeddingDim',
  'closedAt',
] as const;

const SEARCHABLE = [
  'title',
  'company',
  'description',
  'skills',
  'location',
  'modality',
  'salaryText',
  'status',
  'stageLabel',
  'notes',
  'body',
  'note',
  'text',
  'stepsText',
] as const;

const SORTABLE = ['updatedAt'] as const;

/** Dimensión alineada al mock de embeddings (ADR-036). */
const EMBEDDING_DIMENSIONS = 768;

const DISPLAYED = [
  ...FILTERABLE,
  ...SEARCHABLE,
  'linkId',
  'groupId',
  'applicationId',
  'cvId',
  'roadmapId',
  'analysisId',
] as const;

export interface MeiliClientOptions {
  readonly host: string;
  readonly apiKey: string;
  readonly indexUid: string;
}

export class MeiliSearchClientAdapter implements MeiliSearchClient {
  private readonly client: MeiliSearch | null;
  private readonly indexUid: string;
  readonly configured: boolean;

  private ensurePromise: Promise<void> | null = null;

  constructor(options: MeiliClientOptions) {
    this.indexUid = options.indexUid;
    this.configured = options.host.length > 0;
    this.client = this.configured
      ? new MeiliSearch({
          host: options.host,
          apiKey: options.apiKey.length > 0 ? options.apiKey : undefined,
        })
      : null;
  }

  async healthy(): Promise<boolean> {
    if (this.client === null) return false;
    try {
      const health = await this.client.health();
      return health.status === 'available';
    } catch {
      return false;
    }
  }

  async ensureIndex(): Promise<void> {
    if (this.ensurePromise !== null) {
      await this.ensurePromise;
      return;
    }
    this.ensurePromise = this.createAndConfigureIndex();
    try {
      await this.ensurePromise;
    } catch (error) {
      this.ensurePromise = null;
      throw error;
    }
  }

  private async createAndConfigureIndex(): Promise<void> {
    const client = this.requireClient();
    try {
      await client.createIndex(this.indexUid, { primaryKey: 'id' });
    } catch {
      // Ya existe: seguir con settings.
    }
    const index = client.index(this.indexUid);
    await index.updateSettings({
      searchableAttributes: [...SEARCHABLE],
      filterableAttributes: [...FILTERABLE],
      sortableAttributes: [...SORTABLE],
      displayedAttributes: [...DISPLAYED],
    });
    // Vectores userProvided (ADR-036 / D3): sin esto hybrid+vector → MeiliSearchApiError 500.
    await index.updateEmbedders({
      default: {
        source: 'userProvided',
        dimensions: EMBEDDING_DIMENSIONS,
      },
    });
  }

  async upsert(documents: readonly SearchIndexDocument[]): Promise<void> {
    if (documents.length === 0) return;
    await this.ensureIndex();
    const index = this.requireClient().index(this.indexUid);
    const task = await index.addDocuments([...documents], { primaryKey: 'id' });
    await this.requireClient().tasks.waitForTask(task.taskUid);
  }

  async delete(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureIndex();
    const index = this.requireClient().index(this.indexUid);
    const task = await index.deleteDocuments([...ids]);
    await this.requireClient().tasks.waitForTask(task.taskUid);
  }

  async deleteByFilter(filter: string): Promise<void> {
    await this.ensureIndex();
    const index = this.requireClient().index(this.indexUid);
    const task = await index.deleteDocuments({ filter });
    await this.requireClient().tasks.waitForTask(task.taskUid);
  }

  async search(query: MeiliSearchQuery): Promise<MeiliSearchResult> {
    await this.ensureIndex();
    const index = this.requireClient().index(this.indexUid);
    const hybrid =
      query.mode === 'fulltext'
        ? undefined
        : query.vector !== undefined && query.mode !== 'semantic'
          ? { semanticRatio: query.semanticRatio, embedder: 'default' }
          : query.mode === 'semantic' && query.vector !== undefined
            ? { semanticRatio: 1, embedder: 'default' }
            : query.mode === 'hybrid' && query.vector !== undefined
              ? { semanticRatio: query.semanticRatio, embedder: 'default' }
              : undefined;

    const result = await index.search(query.q, {
      filter: query.filter,
      limit: query.limit,
      offset: query.offset,
      ...(hybrid === undefined ? {} : { hybrid }),
      ...(query.vector === undefined
        ? {}
        : { vector: [...query.vector] }),
    });

    const hits: MeiliSearchHit[] = (result.hits ?? []).map((raw) => {
      const hit = raw as Record<string, unknown>;
      return {
        id: String(hit['id'] ?? ''),
        docType: hit['docType'] as SearchDocType,
        score: typeof hit['_rankingScore'] === 'number' ? hit['_rankingScore'] : 0,
        ...(typeof hit['title'] === 'string' ? { title: hit['title'] } : {}),
        ...(typeof hit['body'] === 'string' ? { body: hit['body'] } : {}),
        ...(typeof hit['note'] === 'string' ? { note: hit['note'] } : {}),
        ...(typeof hit['notes'] === 'string' ? { notes: hit['notes'] } : {}),
        ...(typeof hit['text'] === 'string' ? { text: hit['text'] } : {}),
        ...(typeof hit['description'] === 'string'
          ? { description: hit['description'] }
          : {}),
        ...(typeof hit['linkId'] === 'string' ? { linkId: hit['linkId'] } : {}),
        ...(typeof hit['groupId'] === 'string' ? { groupId: hit['groupId'] } : {}),
        ...(typeof hit['applicationId'] === 'string'
          ? { applicationId: hit['applicationId'] }
          : {}),
        ...(typeof hit['cvId'] === 'string' ? { cvId: hit['cvId'] } : {}),
        ...(typeof hit['roadmapId'] === 'string'
          ? { roadmapId: hit['roadmapId'] }
          : {}),
        ...(typeof hit['analysisId'] === 'string'
          ? { analysisId: hit['analysisId'] }
          : {}),
      };
    });

    return {
      hits,
      estimatedTotal: result.estimatedTotalHits ?? hits.length,
    };
  }

  private requireClient(): MeiliSearch {
    if (this.client === null) {
      throw new Error('Meilisearch is not configured');
    }
    return this.client;
  }
}
