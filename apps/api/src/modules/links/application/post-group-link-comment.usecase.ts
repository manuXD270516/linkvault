import type {
  CreateCommentRequest,
  CreateCommentResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  CommentsGroupNotFound,
  LinkNotFound,
  TooManyLinkAttempts,
} from '../domain/errors';
import { createGroupLinkComment } from '../domain/group-link-comment';
import { authorIdsOf, toCommentsSummary, toCommentView } from './comment.mapper';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';
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
import { LINK_LIMITER, type LinkLimiter } from './ports/link-limiter.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';

/**
 * `POST /api/groups/:id/links/:linkId/comments` (spec links/group-comments). Orden fijado en D6 (critic 10 y 11):
 * 1. el texto se valida (el pipe y, otra vez, el dominio): un `400` no cuenta;
 * 2. pertenencia con `memberIdsOf`: quien no es miembro recibe `group_not_found` sin contar;
 * 3. `consume` del límite, **antes y fuera** de la transacción: contar dentro del callback de `withTransaction` contaría
 *    dos veces en un reintento por `WriteConflict`;
 * 4. `addComment`, que abre y cierra la transacción dentro; ante **cualquier** error, incluido el `null` de una relación
 *    que ya no existe (`link_not_found`), se devuelve el intento;
 * 5. con éxito, `void publish` después y fuera de la transacción: la respuesta no espera al aviso.
 *
 * Nunca registra el texto del comentario.
 */
@Injectable()
export class PostGroupLinkComment {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_LINK_COMMENT_REPOSITORY)
    private readonly comments: GroupLinkCommentRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(LINK_LIMITER) private readonly limiter: LinkLimiter,
    @Inject(COMMENTS_CHANGED_PUBLISHER)
    private readonly publisher: CommentsChangedPublisher,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
    request: CreateCommentRequest,
  ): Promise<CreateCommentResponse> {
    const draft = createGroupLinkComment({
      groupId,
      linkId,
      authorId: userId,
      text: request.text,
      now: this.clock.now(),
    });
    const members = new Set(await this.membership.memberIdsOf([groupId]));
    if (!members.has(userId)) {
      throw new CommentsGroupNotFound();
    }
    const key = { kind: 'comment', userId } as const;
    const decision = await this.limiter.consume(key);
    if (!decision.allowed) {
      throw new TooManyLinkAttempts(decision.retryAfterSeconds);
    }
    const added = await this.addOrRefund(key, draft);

    void this.publisher
      .publish({
        groupId,
        linkId,
        commentId: added.comment.id,
        change: 'created',
      })
      .catch(() => undefined);

    const latest =
      (await this.comments.latestByLinks(groupId, [linkId])).get(linkId) ?? [];
    const names = await this.directory.displayNamesOf(
      authorIdsOf([added.comment, ...latest]),
    );
    return {
      comment: toCommentView(added.comment, names, members),
      comments: toCommentsSummary(added.counters, latest, names, members),
    };
  }

  /** El alta, o el intento devuelto y el error tal cual: un comentario que no se guarda no gasta (D6). */
  private async addOrRefund(
    key: { readonly kind: 'comment'; readonly userId: string },
    draft: Parameters<GroupLinkRepository['addComment']>[0],
  ) {
    try {
      const added = await this.groupLinks.addComment(draft);
      if (added === null) {
        throw new LinkNotFound();
      }
      return added;
    } catch (error) {
      await this.limiter.refund(key);
      throw error;
    }
  }
}
