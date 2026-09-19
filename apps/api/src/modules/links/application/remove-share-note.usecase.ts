import { Inject, Injectable } from '@nestjs/common';
import {
  CommentsGroupNotFound,
  LinkNotFound,
  NoteRemovalForbidden,
} from '../domain/errors';
import { mayRemoveNote } from '../domain/share-note';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';

/**
 * `DELETE /api/groups/:id/links/:linkId/note` (spec links/sharing, D3 de group-comments). La nota no se edita: solo se
 * quita. El orden de las comprobaciones es el de critic 5 (iteración 2), y hace que la respuesta no revele si el link
 * tenía nota a quien no puede quitarla:
 * 1. pertenencia: quien no es miembro recibe `group_not_found`;
 * 2. relación: un link que no está en el grupo, `link_not_found`;
 * 3. permiso: quien no compartió el link y no es `owner`, `forbidden`, **haya o no nota**;
 * 4. `clearNote`: `204` la hubiera o no; si la relación desapareció entretanto, `link_not_found`.
 */
@Injectable()
export class RemoveShareNote {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkId: string,
  ): Promise<void> {
    const role = await this.membership.membershipOf(groupId, userId);
    if (role === null) {
      throw new CommentsGroupNotFound();
    }
    const relation = await this.groupLinks.find(groupId, linkId);
    if (relation === null) {
      throw new LinkNotFound();
    }
    if (!mayRemoveNote(relation.sharedBy, userId, role)) {
      throw new NoteRemovalForbidden();
    }
    if (!(await this.groupLinks.clearNote(groupId, linkId))) {
      throw new LinkNotFound();
    }
  }
}
