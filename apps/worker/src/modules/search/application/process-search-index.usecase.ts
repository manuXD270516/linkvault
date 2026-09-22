import {
  SEARCH_DELETE_EVENT_TYPE,
  SEARCH_UPSERT_EVENT_TYPE,
  searchDeletePayloadSchema,
  searchDocumentId,
  searchUpsertPayloadSchema,
  type SearchDeletePayload,
  type SearchDocType,
  type SearchUpsertPayload,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WorkerConfig } from '../../../infrastructure/config/worker-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import {
  MEILI_SEARCH_CLIENT,
  type MeiliSearchClient,
  type SearchIndexDocument,
} from './ports/meili-search-client.port';
import {
  SEARCH_EMBED_TEXTS,
  type SearchEmbedTexts,
} from './ports/search-embed-texts.port';
import {
  SEARCH_AGGREGATE_LOADER,
  type SearchAggregateLoader,
} from './ports/search-aggregate-loader.port';

/**
 * Procesa un job de `search-index` (D1 / D4 / D5).
 * FEATURE_SEARCH=false o Meili no configurado → ack no-op.
 * Recalcula groupIds/visibilityScope desde Mongo; embed vía puerto (stub/embedTexts).
 */
@Injectable()
export class ProcessSearchIndex {
  private readonly logger = new Logger(ProcessSearchIndex.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: WorkerConfig,
    @Inject(MEILI_SEARCH_CLIENT) private readonly meili: MeiliSearchClient,
    @Inject(SEARCH_AGGREGATE_LOADER)
    private readonly loader: SearchAggregateLoader,
    @Inject(SEARCH_EMBED_TEXTS) private readonly embedTexts: SearchEmbedTexts,
  ) {}

  async execute(job: {
    readonly type: string;
    readonly data: unknown;
  }): Promise<void> {
    if (!this.config.FEATURE_SEARCH || !this.meili.configured) {
      return;
    }

    if (job.type === SEARCH_DELETE_EVENT_TYPE || isDeletePayload(job.data)) {
      const payload = searchDeletePayloadSchema.parse(
        isDeletePayload(job.data) ? job.data : job.data,
      );
      await this.handleDelete(payload);
      return;
    }

    const payload = searchUpsertPayloadSchema.parse(job.data);
    await this.handleUpsert(payload);
  }

  /** Entrada directa desde payloads de cola (relay pone solo el payload en job.data). */
  async executePayload(data: unknown): Promise<void> {
    if (!this.config.FEATURE_SEARCH || !this.meili.configured) {
      return;
    }
    const asDelete = searchDeletePayloadSchema.safeParse(data);
    if (asDelete.success) {
      await this.handleDelete(asDelete.data);
      return;
    }
    const asUpsert = searchUpsertPayloadSchema.safeParse(data);
    if (asUpsert.success) {
      await this.handleUpsert(asUpsert.data);
      return;
    }
    this.logger.warn('search-index job has unusable data');
  }

  private async handleDelete(payload: SearchDeletePayload): Promise<void> {
    const id = searchDocumentId(payload.docType, payload.aggregateId);
    await this.meili.delete([id]);
  }

  private async handleUpsert(payload: SearchUpsertPayload): Promise<void> {
    const loaded = await this.loader.load(payload.docType, payload.aggregateId);
    if (loaded === null) {
      await this.meili.delete([
        searchDocumentId(payload.docType, payload.aggregateId),
      ]);
      return;
    }
    const doc = await this.withEmbedding(loaded);
    await this.meili.upsert([doc]);
  }

  private async withEmbedding(
    doc: SearchIndexDocument,
  ): Promise<SearchIndexDocument> {
    const text = searchableText(doc);
    if (text.trim().length === 0) {
      return { ...doc, embeddingStatus: 'missing' };
    }
    try {
      const result = await this.embedTexts([text], {
        userId: doc.ownerUserId,
        sensitivity: 'personal',
      });
      const vector = result.vectors[0];
      if (vector === undefined) {
        return { ...doc, embeddingStatus: 'missing' };
      }
      return {
        ...doc,
        embeddingStatus: 'ready',
        embedModelId: result.model,
        embeddingDim: result.dimensions,
        _vectors: { default: vector },
      };
    } catch {
      return { ...doc, embeddingStatus: 'failed' };
    }
  }
}

function isDeletePayload(data: unknown): data is SearchDeletePayload {
  return (
    typeof data === 'object' &&
    data !== null &&
    'reason' in data &&
    typeof (data as { reason: unknown }).reason === 'string' &&
    String((data as { reason: string }).reason).includes('deleted')
  );
}

function searchableText(doc: SearchIndexDocument): string {
  return [
    doc.title,
    doc.company,
    doc.description,
    doc.location,
    doc.modality,
    doc.salaryText,
    doc.status,
    doc.stageLabel,
    doc.notes,
    doc.body,
    doc.note,
    doc.text,
    doc.stepsText,
    ...(doc.skills ?? []),
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join('\n');
}

export type { SearchDocType };
