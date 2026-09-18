import { Injectable } from '@nestjs/common';
import { UsersFacade } from '../../users/application/users.facade';
import type {
  LinkUserAiConsent,
  LinkUserDirectory,
} from '../application/ports/link-user-directory.port';

/**
 * Adaptador LINK_USER_DIRECTORY sobre el `UsersFacade` que exporta `UsersModule` (D1 de job-links). `links` no lee la
 * colección `users` ni conoce más que el nombre visible de quien compartió: el facade resuelve todos los ids de la
 * página en una sola consulta y deja fuera del mapa los que no corresponden a ningún usuario. El email nunca sale. Del
 * perfil de quien pega solo lee si consintió enviar sus datos a proveedores de IA externos.
 */
@Injectable()
export class UsersFacadeLinkDirectory implements LinkUserDirectory {
  constructor(private readonly users: UsersFacade) {}

  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    return this.users.getDisplayNames(userIds);
  }

  /** Solo el permiso de enviar datos a proveedores externos: el resto del perfil no sale de `users`. */
  async aiConsentOf(userId: string): Promise<LinkUserAiConsent> {
    const { externalProviders } = await this.users.aiConsentOf(userId);
    return { externalProviders };
  }
}
