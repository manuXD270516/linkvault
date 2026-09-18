import { Inject, Injectable } from '@nestjs/common';
import { LinkNotFound } from '../domain/errors';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

/**
 * `DELETE /api/links/mine/:linkId` (spec links/sharing): quitar un link de la lista privada. Nadie más puede tocar esa
 * lista, así que no hay permisos que juzgar: un link que no está en ella responde `link_not_found`, lo mismo que un
 * identificador mal formado. El `JobLink` no se borra nunca.
 */
@Injectable()
export class RemoveMyLink {
  constructor(
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
  ) {}

  async execute(userId: string, linkId: string): Promise<void> {
    if (!(await this.userLinks.remove(userId, linkId))) {
      throw new LinkNotFound();
    }
  }
}
