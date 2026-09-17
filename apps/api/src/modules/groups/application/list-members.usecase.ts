import type { GroupMember } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { resolveGroupAccess } from './group-access';
import { toGroupMember } from './group.mapper';
import {
  GROUP_MEMBER_DIRECTORY,
  type GroupMemberDirectory,
} from './ports/group-member-directory.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `GET /api/groups/:id/members` (spec groups/membership): cualquier miembro ve la lista, por `joinedAt` ascendente (el
 * owner primero, por antigüedad). Los nombres visibles llegan por el directorio en una sola consulta (D7); `groups` no
 * lee la colección `users`, y el email no sale de ahí ni por error. Quien no es miembro recibe `group_not_found`.
 */
@Injectable()
export class ListMembers {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
    @Inject(GROUP_MEMBER_DIRECTORY)
    private readonly directory: GroupMemberDirectory,
  ) {}

  async execute(userId: string, groupId: string): Promise<GroupMember[]> {
    const { group } = await resolveGroupAccess(this.groups, groupId, userId);
    const members = await this.groups.listMembers(group.id);
    const names = await this.directory.displayNamesOf(
      members.map((member) => member.userId),
    );
    return members.map((member) =>
      toGroupMember(member, names.get(member.userId)),
    );
  }
}
