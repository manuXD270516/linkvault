import { Inject, Injectable } from '@nestjs/common';
import { LinkNotFound } from '../domain/errors';
import { requireReadableLink } from './link-access';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkCard,
  type JobLinkRepository,
} from './ports/job-link-repository.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';

export type { JobLinkCard } from './ports/job-link-repository.port';

// Única entrada de otros módulos a `links` (D1 de applications-tracking, spec links/sharing "Links disponibles para
// otros módulos"). Ningún archivo de dominio, aplicación o infraestructura de otro módulo lee las colecciones de links
// ni importa sus repositorios (lo comprueba el lint). Solo lecturas: guardar, compartir o quitar pasa por la API.
//
// Un identificador mal formado se trata como un link que no existe, sin error, igual que en los repositorios.

@Injectable()
export class LinksFacade {
  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
  ) {}

  /**
   * `true` si la persona ve el link: lo tiene en su lista privada o está compartido en un grupo del que es miembro. Es
   * el mismo permiso que usan la edición del preview y el reintento de su lectura (`requireReadableLink`).
   */
  async canRead(userId: string, linkId: string): Promise<boolean> {
    try {
      await requireReadableLink(
        {
          links: this.links,
          groupLinks: this.groupLinks,
          userLinks: this.userLinks,
          membership: this.membership,
        },
        userId,
        linkId,
      );
      return true;
    } catch (error) {
      if (error instanceof LinkNotFound) {
        return false;
      }
      throw error;
    }
  }

  /** Fichas de esos links en una sola consulta; los que no existen o están mal formados no aportan nada. */
  async cardsOf(linkIds: readonly string[]): Promise<JobLinkCard[]> {
    return await this.links.cardsOf(linkIds);
  }

  /** De esos links, cuáles están compartidos ahora en el grupo, en una sola consulta. */
  async linkIdsSharedIn(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Set<string>> {
    return await this.groupLinks.linkIdsIn(groupId, linkIds);
  }
}
