import type { CommentPage, ListCommentsQuery } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { CommentsGroupNotFound, LinkNotFound } from '../domain/errors';
import { authorIdsOf, toCommentPage } from './comment.mapper';
import { decodeCursor } from './link-cursor';
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
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';

/**
 * `GET /api/groups/:id/links/:linkId/comments` (spec links/group-comments): el hilo de un link **en ese grupo**, del más
 * reciente al más antiguo, paginado con el mismo cursor opaco que los listados de links. Ver el link por otro grupo o
 * por la lista privada no basta: los comentarios son contexto del grupo (D4).
 *
 * Cuatro lecturas fijas por página (D7): los miembros —que dan la pertenencia y `authorLeft` para toda la página—, la
 * relación —cuyo `commentCount` es el `total`—, la página y los nombres de sus autores.
 */
@Injectable()
export class ListGroupLinkComments {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_LINK_COMMENT_REPOSITORY)
    private readonly comments: GroupLinkCommentRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
    query: ListCommentsQuery,
  ): Promise<CommentPage> {
    const members = new Set(await this.membership.memberIdsOf([groupId]));
    if (!members.has(userId)) {
      throw new CommentsGroupNotFound();
    }
    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const relation = await this.groupLinks.find(groupId, linkId);
    if (relation === null) {
      throw new LinkNotFound();
    }
    const page = await this.comments.page(groupId, linkId, {
      limit: query.limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const names = await this.directory.displayNamesOf(authorIdsOf(page.items));
    return toCommentPage(page, relation.commentCount, names, members);
  }
}
