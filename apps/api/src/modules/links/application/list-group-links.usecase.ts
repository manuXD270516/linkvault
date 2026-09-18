import type { LinkPage, ListLinksQuery } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound } from '../../groups/domain/errors';
import { toLinkListQuery } from './link-cursor';
import { displayNameIdsOf, toLinkPage } from './link.mapper';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';

/**
 * `GET /api/groups/:id/links` (spec links/sharing): los links del grupo para sus miembros, del más reciente al más
 * antiguo y, a igualdad de fecha, por identificador, paginados con un cursor opaco. Vive en `links` y no en `groups`
 * porque su contenido es de este módulo; la pertenencia se resuelve por el puerto, sin leer las colecciones de `groups`.
 *
 * Quien no es miembro recibe `group_not_found`, igual que si el grupo no existiera: un extraño no puede distinguirlos ni
 * enterarse de cuántas ofertas hay dentro. Los nombres visibles —quien compartió y quien escribió a mano cualquier campo
 * del preview— se resuelven en **una sola consulta** por página, no una por link ni una por campo.
 */
@Injectable()
export class ListGroupLinks {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    query: ListLinksQuery,
  ): Promise<LinkPage> {
    if ((await this.membership.membershipOf(groupId, userId)) === null) {
      throw new GroupNotFound();
    }
    const page = await this.groupLinks.listByGroup(
      groupId,
      toLinkListQuery(query),
    );
    const total = await this.groupLinks.countByGroup(groupId);
    const names = await this.directory.displayNamesOf(
      displayNameIdsOf(
        page.items.map((item) => item.link),
        page.items.map((item) => item.sharedBy),
      ),
    );
    return toLinkPage(page, total, names);
  }
}
