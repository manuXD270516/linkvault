import { Injectable } from '@nestjs/common';
import { UsersFacade } from '../../users/application/users.facade';
import type { GroupMemberDirectory } from '../application/ports/group-member-directory.port';

/**
 * Adaptador GROUP_MEMBER_DIRECTORY sobre el `UsersFacade` que exporta `UsersModule` (D7). `groups` no lee la colección
 * `users` ni conoce más que el nombre visible: el facade resuelve los ids en una sola consulta y deja fuera del mapa los
 * que no corresponden a ningún usuario.
 */
@Injectable()
export class UsersFacadeMemberDirectory implements GroupMemberDirectory {
  constructor(private readonly users: UsersFacade) {}

  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    return this.users.getDisplayNames(userIds);
  }
}
