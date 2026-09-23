import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  type ApplicationStatus,
  type JobModality,
  type SearchDocType,
  type SearchHit,
  type SearchMode,
  type SearchResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { buildSearchAclFilter } from '../domain/acl-filter';
import { EmptySearchQuery, SearchUnavailable } from '../domain/errors';
import {
  MEILI_SEARCH_CLIENT,
  type MeiliSearchClient,
} from './ports/meili-search-client.port';
import {
  SEARCH_EMBED_TEXTS,
  type SearchEmbedTexts,
} from './ports/search-embed-texts.port';
import {
  SEARCH_MEMBERSHIP,
  type SearchMembership,
} from './ports/search-membership.port';

export interface SearchQueryInput {
  readonly q: string;
  readonly docType?: SearchDocType;
  readonly groupId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly mode?: SearchMode;
  readonly modality?: JobModality;
  /** Query param; se mapea al atributo Meili `status`. */
  readonly applicationStatus?: ApplicationStatus;
  readonly salaryCurrency?: string;
  /** Cuando true, AND Meili `closedAt IS NULL`. */
  readonly openOnly?: boolean;
  /** Usuario acepta desde M; solape D1 / ADR-040. */
  readonly minSalary?: number;
  /** Usuario acepta hasta X; solape D1 / ADR-040. */
  readonly maxSalary?: number;
}

/**
 * `GET /api/search` (D6 / D7 / C7 / C11 / C14; filtros LatAm D1). ACL solo server-side;
 * default mode hybrid.
 */
@Injectable()
export class SearchContent {
  constructor(
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    @Inject(MEILI_SEARCH_CLIENT) private readonly meili: MeiliSearchClient,
    @Inject(SEARCH_MEMBERSHIP) private readonly membership: SearchMembership,
    @Inject(SEARCH_EMBED_TEXTS) private readonly embedTexts: SearchEmbedTexts,
  ) {}

  async execute(
    userId: string,
    input: SearchQueryInput,
  ): Promise<SearchResponse> {
    if (!this.config.FEATURE_SEARCH || !this.meili.configured) {
      throw new SearchUnavailable();
    }
    const q = input.q.trim();
    if (q.length === 0) {
      throw new EmptySearchQuery();
    }
    if (!(await this.meili.healthy())) {
      throw new SearchUnavailable();
    }

    const limit = Math.min(
      input.limit === undefined ? SEARCH_LIMIT_DEFAULT : input.limit,
      SEARCH_LIMIT_MAX,
    );
    const offset = input.offset ?? 0;
    const mode: SearchMode = input.mode ?? 'hybrid';

    const memberGroupIds = await this.membership.groupIdsOf(userId);
    const filter = buildSearchAclFilter({
      userId,
      memberGroupIds,
      ...(input.docType === undefined ? {} : { docType: input.docType }),
      ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
      ...(input.modality === undefined ? {} : { modality: input.modality }),
      ...(input.applicationStatus === undefined
        ? {}
        : { status: input.applicationStatus }),
      ...(input.salaryCurrency === undefined
        ? {}
        : { salaryCurrency: input.salaryCurrency }),
      ...(input.openOnly === true ? { openOnly: true } : {}),
      ...(input.minSalary === undefined ? {} : { minSalary: input.minSalary }),
      ...(input.maxSalary === undefined ? {} : { maxSalary: input.maxSalary }),
    });

    let vector: number[] | undefined;
    let degraded = false;
    if (mode === 'hybrid' || mode === 'semantic') {
      try {
        const embedded = await this.embedTexts([q], {
          userId,
          sensitivity: 'personal',
        });
        vector = embedded.vectors[0];
      } catch {
        degraded = true;
      }
    }

    const effectiveMode: SearchMode =
      degraded || vector === undefined
        ? 'fulltext'
        : mode;

    let result;
    try {
      result = await this.meili.search({
        q,
        filter,
        limit,
        offset,
        mode: effectiveMode,
        semanticRatio: this.config.SEARCH_SEMANTIC_RATIO,
        ...(vector === undefined ? {} : { vector }),
      });
    } catch {
      throw new SearchUnavailable();
    }

    const hits: SearchHit[] = result.hits.map((hit) => ({
      id: hit.id,
      docType: hit.docType,
      title: hit.title ?? hit.body ?? hit.note ?? hit.notes ?? hit.text ?? '',
      ...(snippetOf(hit) === undefined ? {} : { snippet: snippetOf(hit) }),
      score: hit.score,
      ...(hit.linkId === undefined ? {} : { linkId: hit.linkId }),
      ...(hit.groupId === undefined ? {} : { groupId: hit.groupId }),
      ...(hit.applicationId === undefined
        ? {}
        : { applicationId: hit.applicationId }),
      ...(hit.cvId === undefined ? {} : { cvId: hit.cvId }),
      ...(hit.roadmapId === undefined ? {} : { roadmapId: hit.roadmapId }),
      ...(hit.analysisId === undefined ? {} : { analysisId: hit.analysisId }),
    }));

    return {
      hits,
      limit,
      offset,
      estimatedTotal: result.estimatedTotal,
      ...(degraded
        ? { degraded: true, degradeReason: 'embeddings_unavailable' as const }
        : {}),
    };
  }
}

function snippetOf(hit: {
  body?: string;
  note?: string;
  notes?: string;
  text?: string;
  description?: string;
}): string | undefined {
  const raw =
    hit.body ?? hit.note ?? hit.notes ?? hit.description ?? hit.text;
  if (raw === undefined || raw.length === 0) return undefined;
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}
