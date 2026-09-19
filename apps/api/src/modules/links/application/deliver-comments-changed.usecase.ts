import {
  groupLinkCommentsMessage,
  type GroupLinkCommentsChangedPayload,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { authorIdsOf, toCommentsSummary } from './comment.mapper';
import {
  COMMENTS_BROADCASTER,
  type CommentsBroadcaster,
} from './ports/comments-broadcaster.port';
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
 * Reparto de un aviso de comentarios (D9 de group-comments, spec platform/realtime). El aviso de Redis solo dice "cambió
 * el hilo de este link en este grupo"; lo que sale hacia cada navegador se compone aquí con lo que dice la base de datos.
 *
 * - **Nadie escucha** en este proceso: se descarta sin leer nada.
 * - **Destinatarios**: los miembros **actuales** de ese grupo, no quienes ven el link por otro grupo o por su lista
 *   privada. Quien sale justo durante el reparto puede recibir un último aviso de algo que podía ver un instante antes
 *   (carrera aceptada por escrito, critic 17).
 * - **Link quitado antes de repartir**: sin relación no se envía nada.
 * - **Qué lleva**: el resumen ya actualizado —`count`, `revision`, `sharedAt` y los dos últimos con su texto, su autor y
 *   `authorLeft`—, el mismo para todos.
 *
 * Lecturas por aviso, fijas: miembros, relación, los dos últimos y sus nombres.
 */
@Injectable()
export class DeliverCommentsChanged {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_LINK_COMMENT_REPOSITORY)
    private readonly comments: GroupLinkCommentRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(COMMENTS_BROADCASTER)
    private readonly broadcaster: CommentsBroadcaster,
  ) {}

  /** Reparte el aviso y devuelve a cuántas conexiones llegó. Cero es un resultado normal, no un error. */
  async execute(notice: GroupLinkCommentsChangedPayload): Promise<number> {
    if (!this.broadcaster.hasListeners()) {
      return 0;
    }
    const members = await this.membership.memberIdsOf([notice.groupId]);
    if (members.length === 0) {
      return 0;
    }
    const relation = await this.groupLinks.find(notice.groupId, notice.linkId);
    if (relation === null) {
      return 0;
    }
    const latest =
      (
        await this.comments.latestByLinks(notice.groupId, [notice.linkId])
      ).get(notice.linkId) ?? [];
    const names =
      latest.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(authorIdsOf(latest));
    const message = groupLinkCommentsMessage(
      notice,
      toCommentsSummary(
        {
          count: relation.commentCount,
          revision: relation.commentsRevision,
          sharedAt: relation.sharedAt,
        },
        latest,
        names,
        new Set(members),
      ),
    );
    let delivered = 0;
    for (const userId of members) {
      delivered += this.broadcaster.send(userId, message);
    }
    return delivered;
  }
}
