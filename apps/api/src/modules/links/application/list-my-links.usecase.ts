import type { LinkPage, ListLinksQuery } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { toLinkListQuery } from './link-cursor';
import { displayNameIdsOf, toLinkPage } from './link.mapper';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

/**
 * `GET /api/links/mine` (spec links/sharing): la lista privada, lo que el usuario guardó **sin** grupo. No incluye lo
 * que solo guardó dentro de un grupo. Misma paginación y mismo `total` que el listado de un grupo.
 *
 * Aquí no hay `sharedBy` que resolver —en esta lista no hay con quién compartir—, pero sí puede haber campos del preview
 * escritos a mano por quien sea que comparta el link en otro sitio: sus nombres se piden en una sola consulta por
 * página, no una por campo (D4).
 */
@Injectable()
export class ListMyLinks {
  constructor(
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
  ) {}

  async execute(userId: string, query: ListLinksQuery): Promise<LinkPage> {
    const page = await this.userLinks.listByUser(userId, toLinkListQuery(query));
    const total = await this.userLinks.countByUser(userId);
    const authors = displayNameIdsOf(page.items.map((item) => item.link));
    const names =
      authors.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(authors);
    return toLinkPage(page, total, names);
  }
}
