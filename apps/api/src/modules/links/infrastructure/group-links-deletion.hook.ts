import { Inject, Injectable } from '@nestjs/common';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from '../application/ports/group-link-repository.port';
import type { TransactionSession } from '../application/ports/transaction-session';

/**
 * Limpieza de `links` cuando se borra un grupo (D7b de job-links): se borran sus `GroupLink` y **nunca** los `JobLink`,
 * que siguen disponibles en los demás grupos y en las listas privadas. Corre dentro de la transacción de `groups`, con
 * su sesión, así que o se borra todo o no se borra nada.
 *
 * No importa el tipo `GroupDeletionHook` de `groups` a propósito: los límites entre módulos solo dejan entrar a otro
 * módulo desde `presentation`, que es donde se cablea. Allí, al registrarlo, se comprueba que esta clase encaja.
 */
@Injectable()
export class GroupLinksDeletionHook {
  constructor(
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
  ) {}

  async deleteRelationsOf(
    groupId: string,
    session: TransactionSession,
  ): Promise<void> {
    await this.groupLinks.deleteByGroup(groupId, session);
  }
}
