import {
  SEARCH_LIMIT_MAX,
  searchResponseSchema,
  type SearchDocType,
  type SearchMode,
  type SearchResponse,
} from '@linkvault/shared';
import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { SearchContent } from '../application/search-content.usecase';

/**
 * `GET /api/search` (D7). Sesión obligatoria (guard global). SPA V0 no envía `mode`.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchContent) {}

  @Get()
  async query(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q: string | undefined,
    @Query('docType') docType: string | undefined,
    @Query('groupId') groupId: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('offset') offsetRaw: string | undefined,
    @Query('mode') modeRaw: string | undefined,
  ): Promise<SearchResponse> {
    const limit = parsePositiveInt(limitRaw);
    const offset = parseNonNegativeInt(offsetRaw);
    const result = await this.search.execute(user.userId, {
      q: q ?? '',
      ...(isDocType(docType) ? { docType } : {}),
      ...(typeof groupId === 'string' && groupId.length > 0
        ? { groupId }
        : {}),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
      ...(isMode(modeRaw) ? { mode: modeRaw } : {}),
    });
    return searchResponseSchema.parse(result);
  }
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return Math.min(n, SEARCH_LIMIT_MAX * 20);
}

function parseNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

const DOC_TYPES: readonly SearchDocType[] = [
  'job_preview',
  'application',
  'group_comment',
  'group_link_note',
  'cv',
  'roadmap',
];

function isDocType(value: string | undefined): value is SearchDocType {
  return (
    typeof value === 'string' &&
    (DOC_TYPES as readonly string[]).includes(value)
  );
}

function isMode(value: string | undefined): value is SearchMode {
  return value === 'hybrid' || value === 'fulltext' || value === 'semantic';
}
