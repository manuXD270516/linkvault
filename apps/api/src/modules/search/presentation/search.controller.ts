import {
  searchQueryParamsSchema,
  searchResponseSchema,
  type SearchQueryParams,
  type SearchResponse,
} from '@linkvault/shared';
import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { SearchContent } from '../application/search-content.usecase';

/**
 * `GET /api/search` (D7; filtros LatAm D1). Sesión obligatoria (guard global).
 * SPA V0 no envía `mode`; sí puede enviar modality / applicationStatus / salaryCurrency.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchContent) {}

  @Get()
  async query(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(searchQueryParamsSchema))
    query: SearchQueryParams,
  ): Promise<SearchResponse> {
    const result = await this.search.execute(user.userId, {
      q: query.q,
      ...(query.docType === undefined ? {} : { docType: query.docType }),
      ...(query.groupId === undefined ? {} : { groupId: query.groupId }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.offset === undefined ? {} : { offset: query.offset }),
      ...(query.mode === undefined ? {} : { mode: query.mode }),
      ...(query.modality === undefined ? {} : { modality: query.modality }),
      ...(query.applicationStatus === undefined
        ? {}
        : { applicationStatus: query.applicationStatus }),
      ...(query.salaryCurrency === undefined
        ? {}
        : { salaryCurrency: query.salaryCurrency }),
    });
    return searchResponseSchema.parse(result);
  }
}
