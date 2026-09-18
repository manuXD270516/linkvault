import type { LinkPage, ListLinksQuery } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { toLinkListQuery } from './link-cursor';
import { toLinkPage } from './link.mapper';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

/**
 * `GET /api/links/mine` (spec links/sharing): la lista privada, lo que el usuario guardó **sin** grupo. No incluye lo
 * que solo guardó dentro de un grupo, y por eso no hay nombres que resolver: en esta lista no hay con quién compartir.
 * Misma paginación y mismo `total` que el listado de un grupo.
 */
@Injectable()
export class ListMyLinks {
  constructor(
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
  ) {}

  async execute(userId: string, query: ListLinksQuery): Promise<LinkPage> {
    const page = await this.userLinks.listByUser(userId, toLinkListQuery(query));
    const total = await this.userLinks.countByUser(userId);
    return toLinkPage(page, total, new Map());
  }
}
