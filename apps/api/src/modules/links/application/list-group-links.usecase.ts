import type { LinkPage, ListGroupLinksQuery } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound } from '../../groups/domain/errors';
import type { GroupLinkComment } from '../domain/group-link-comment';
import {
  authorIdsOf,
  toCommentsSummary,
  toShareNoteView,
} from './comment.mapper';
import { encodeCursor, toGroupLinkListQuery } from './link-cursor';
import {
  displayNameIdsOf,
  previewAuthorIdsOf,
  toJobLinkSummary,
  toLinkSharer,
} from './link.mapper';
import {
  GROUP_LINK_COMMENT_REPOSITORY,
  type GroupLinkCommentRepository,
} from './ports/group-link-comment-repository.port';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';
import type { ListedLink } from './ports/link-listing';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import { PUBLIC_URLS, type PublicUrls } from './ports/public-urls.port';
import { toPublicShareView } from './public-share.mapper';
import { visibleAuthorsFor, type VisibleAuthors } from './visible-authors';

/**
 * `GET /api/groups/:id/links` (spec links/sharing): los links del grupo para sus miembros, del más reciente al más
 * antiguo y, a igualdad de fecha, por identificador, paginados con un cursor opaco. Vive en `links` y no en `groups`
 * porque su contenido es de este módulo; la pertenencia se resuelve por el puerto, sin leer las colecciones de `groups`.
 *
 * Quien no es miembro recibe `group_not_found`, igual que si el grupo no existiera: un extraño no puede distinguirlos ni
 * enterarse de cuántas ofertas hay dentro.
 *
 * Cada link trae la nota de quien lo compartió y el resumen de sus comentarios en este grupo (D7 de group-comments),
 * con **cinco lecturas fijas por página**, sea de 2 links o de 50 (más una consulta de `peersAmong` cuando el preview
 * tiene autores ajenos al lector: el nombre de un autor solo sale si comparte un grupo con quien lee, H1 de
 * usage-guide-fixes):
 * 1. `memberIdsOf`, que da la pertenencia y `authorLeft` para toda la página;
 * 2. la página, que ya trae la nota y los contadores de cada relación;
 * 3. el total;
 * 4. una agregación con los dos últimos comentarios de cada link;
 * 5. los nombres visibles —quien compartió, quien escribió a mano el preview y los autores—, en una sola llamada.
 */
@Injectable()
export class ListGroupLinks {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_LINK_COMMENT_REPOSITORY)
    private readonly comments: GroupLinkCommentRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(PUBLIC_URLS) private readonly urls: PublicUrls,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    query: ListGroupLinksQuery,
  ): Promise<LinkPage> {
    const members = new Set(await this.membership.memberIdsOf([groupId]));
    if (!members.has(userId)) {
      throw new GroupNotFound();
    }
    const listQuery = toGroupLinkListQuery(query);
    const page = await this.groupLinks.listByGroup(groupId, listQuery);
    const total = await this.groupLinks.countByGroup(groupId, listQuery);
    const latest = await this.comments.latestByLinks(
      groupId,
      page.items.map((item) => item.link.id),
    );
    const links = page.items.map((item) => item.link);
    // El nombre de quien corrigió el preview solo sale si quien lee comparte un grupo con él (H1, ADR-055 §2).
    const visibleAuthors = await visibleAuthorsFor(
      this.membership,
      userId,
      previewAuthorIdsOf(links),
    );
    const names = await this.directory.displayNamesOf([
      ...displayNameIdsOf(
        links,
        visibleAuthors,
        page.items.map((item) => item.sharedBy),
      ),
      ...authorIdsOf([...latest.values()].flat()),
    ]);
    return {
      items: page.items.map((item) =>
        toGroupItem(
          item,
          latest.get(item.link.id) ?? [],
          names,
          members,
          this.urls,
          userId,
          visibleAuthors,
        ),
      ),
      total,
      ...(page.nextCursor === undefined
        ? {}
        : { nextCursor: encodeCursor(page.nextCursor) }),
    };
  }
}

/** Fila del listado del grupo, con su nota y el resumen de sus comentarios. */
function toGroupItem(
  item: ListedLink,
  latest: readonly GroupLinkComment[],
  names: Map<string, string>,
  members: ReadonlySet<string>,
  urls: PublicUrls,
  viewerId: string,
  visibleAuthors: VisibleAuthors,
): LinkPage['items'][number] {
  const inGroup = item.inGroup ?? {
    commentCount: 0,
    commentsRevision: 0,
    knowSomeoneUserIds: [],
    tags: [],
    pinned: false,
  };
  const knowSomeoneUserIds = inGroup.knowSomeoneUserIds ?? [];
  return toJobLinkSummary(item.link, {
    sharedAt: item.sharedAt,
    names,
    visibleAuthors,
    ...(item.sharedBy === undefined
      ? {}
      : { sharedBy: toLinkSharer(item.sharedBy, names.get(item.sharedBy)) }),
    ...(inGroup.note === undefined
      ? {}
      : { note: toShareNoteView(inGroup.note) }),
    // Viene en la misma consulta de la relación (D1): el interruptor NO cuesta una lectura más, ni con 2 links ni con
    // 20. Solo se mapea la URL, que se compone con la configuración.
    ...(inGroup.publicShare === undefined
      ? {}
      : { publicShare: toPublicShareView(inGroup.publicShare, urls) }),
    comments: toCommentsSummary(
      {
        count: inGroup.commentCount,
        revision: inGroup.commentsRevision,
        sharedAt: item.sharedAt,
      },
      latest,
      names,
      members,
    ),
    // Siempre presente en el listado del grupo (D3 de know-someone-flag); la lista privada no lo proyecta.
    knowSomeone: {
      flaggedByMe: knowSomeoneUserIds.includes(viewerId),
      count: knowSomeoneUserIds.length,
    },
    // Siempre presentes en el listado del grupo (D4 de group-link-tags-pinned); la lista privada no los proyecta.
    tags: [...(inGroup.tags ?? [])],
    pinned: inGroup.pinned ?? false,
  });
}
