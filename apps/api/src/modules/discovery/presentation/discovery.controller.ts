import {
  discoverySearchQuerySchema,
  discoverySearchResponseSchema,
  type DiscoverySearchQuery,
  type DiscoverySearchResponse,
} from '@linkvault/shared';
import { Controller, Get, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { SearchDiscovery } from '../application/search-discovery.usecase';

/**
 * `GET /api/discovery/search` (ADR-043 / D2). Sesión obligatoria (guard global).
 */
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly search: SearchDiscovery) {}

  @Get('search')
  async searchJobs(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(discoverySearchQuerySchema))
    query: DiscoverySearchQuery,
  ): Promise<DiscoverySearchResponse> {
    const result = await this.search.execute(user.userId, {
      q: query.q,
      board: query.board,
      page: query.page,
      pageSize: query.pageSize,
    });
    return discoverySearchResponseSchema.parse(result);
  }
}
