import { Injectable } from '@nestjs/common';
import { UsersFacade } from '../../users/application/users.facade';
import type { ApplicationUserDirectory } from '../application/ports/application-user-directory.port';

/**
 * Adaptador APPLICATION_USER_DIRECTORY sobre el `UsersFacade` que exporta `UsersModule`: todos los nombres de una
 * respuesta en una sola consulta. El email nunca sale de `users`.
 */
@Injectable()
export class UsersFacadeApplicationDirectory implements ApplicationUserDirectory {
  constructor(private readonly users: UsersFacade) {}

  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    return this.users.getDisplayNames(userIds);
  }
}
