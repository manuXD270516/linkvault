import type { LinkPage, ListLinksQuery } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { toLinkListQuery } from './link-cursor';
import {
  displayNameIdsOf,
  previewAuthorIdsOf,
  toLinkPage,
} from './link.mapper';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';
import { visibleAuthorsFor } from './visible-authors';

/**
 * `GET /api/links/mine` (spec links/sharing): la lista privada, lo que el usuario guardó **sin** grupo. No incluye lo
 * que solo guardó dentro de un grupo. Misma paginación y mismo `total` que el listado de un grupo.
 *
 * Aquí no hay `sharedBy` que resolver —en esta lista no hay con quién compartir—, pero sí puede haber campos del preview
 * escritos a mano por quien sea que comparta el link en otro sitio: sus nombres se piden en una sola consulta por
 * página, no una por campo (D4). Los de quienes no comparten ningún grupo con quien lee no se piden ni salen: `by: null`.
 */
@Injectable()
export class ListMyLinks {
  constructor(
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  async execute(userId: string, query: ListLinksQuery): Promise<LinkPage> {
    const page = await this.userLinks.listByUser(
      userId,
      toLinkListQuery(query),
    );
    const total = await this.userLinks.countByUser(userId);
    const links = page.items.map((item) => item.link);
    // El nombre de un autor solo sale si quien lee comparte un grupo con él (H1, ADR-055 §2).
    const visibleAuthors = await visibleAuthorsFor(
      this.membership,
      userId,
      previewAuthorIdsOf(links),
    );
    const authors = displayNameIdsOf(links, visibleAuthors);
    const names =
      authors.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(authors);
    return toLinkPage(page, total, names, visibleAuthors);
  }
}
