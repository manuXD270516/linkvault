import type { DeleteCommentResponse } from '@linkvault/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { SearchFacade } from '../../search/application/search.facade';
import {
  CommentDeletionForbidden,
  CommentNotFound,
  CommentsGroupNotFound,
} from '../domain/errors';
import { mayDeleteComment } from '../domain/group-link-comment';
import { authorIdsOf, toCommentsSummary } from './comment.mapper';
import {
  COMMENTS_CHANGED_PUBLISHER,
  type CommentsChangedPublisher,
} from './ports/comments-changed-publisher.port';
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
 * `DELETE /api/groups/:id/links/:linkId/comments/:commentId` (spec links/group-comments). Orden fijado en D6 (critic 3 y
 * 4 de la iteración 2), sin límite: borrar no cuenta.
 * 1. pertenencia con rol: quien no es miembro recibe `group_not_found`;
 * 2. el comentario, de ese link en ese grupo: si no está, `comment_not_found`;
 * 3. permiso: su autor o el `owner` (decisión humana 5); otro miembro recibe `forbidden`, porque ya ve el comentario;
 * 4. `removeComment`: si otro borrado se adelantó (`null`), `comment_not_found` **sin aviso**; si no, `200` con el
 *    resumen nuevo y `void publish`.
 * 5. SearchDelete `group_comment` vía SearchFacade si FEATURE_SEARCH.
 *
 * El rol se lee antes de la transacción: la ventana de un owner que acaba de transferir la propiedad está aceptada por
 * escrito (D6), como en el resto de permisos por rol de `links`.
 */
@Injectable()
export class DeleteGroupLinkComment {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_LINK_COMMENT_REPOSITORY)
    private readonly comments: GroupLinkCommentRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(COMMENTS_CHANGED_PUBLISHER)
    private readonly publisher: CommentsChangedPublisher,
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Optional() private readonly search?: SearchFacade,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
    commentId: string,
  ): Promise<DeleteCommentResponse> {
    const role = await this.membership.membershipOf(groupId, userId);
    if (role === null) {
      throw new CommentsGroupNotFound();
    }
    const comment = await this.comments.find(groupId, linkId, commentId);
    if (comment === null) {
      throw new CommentNotFound();
    }
    if (!mayDeleteComment(comment, userId, role)) {
      throw new CommentDeletionForbidden();
    }
    const counters = await this.groupLinks.removeComment(
      groupId,
      linkId,
      commentId,
    );
    if (counters === null) {
      // Otro borrado se adelantó: para quien pide, el comentario ya no está. Un borrado que no ocurrió no avisa.
      throw new CommentNotFound();
    }

    void this.publisher
      .publish({ groupId, linkId, commentId, change: 'deleted' })
      .catch(() => undefined);

    await this.emitSearchDelete(commentId);

    const members = new Set(await this.membership.memberIdsOf([groupId]));
    const latest =
      (await this.comments.latestByLinks(groupId, [linkId])).get(linkId) ?? [];
    const names =
      latest.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(authorIdsOf(latest));
    return {
      comments: toCommentsSummary(counters, latest, names, members),
    };
  }

  private async emitSearchDelete(commentId: string): Promise<void> {
    if (this.search?.enabled !== true) {
      return;
    }
    const search = this.search;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await search.delete(
          {
            docType: 'group_comment',
            aggregateId: commentId,
            reason: 'aggregate_deleted',
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
}
