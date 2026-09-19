import { Injectable } from '@nestjs/common';
import { LinksFacade } from '../../links/application/links.facade';
import type {
  ApplicationLinks,
  LinkCard,
} from '../application/ports/application-links.port';

/**
 * Adaptador APPLICATION_LINKS sobre el `LinksFacade` que exporta `LinksModule` (D1 de applications-tracking).
 * `applications` no lee las colecciones de links: cada método es una sola consulta del lado de `links`.
 */
@Injectable()
export class LinksFacadeApplicationLinks implements ApplicationLinks {
  constructor(private readonly links: LinksFacade) {}

  canRead(userId: string, linkId: string): Promise<boolean> {
    return this.links.canRead(userId, linkId);
  }

  async cardsOf(linkIds: readonly string[]): Promise<LinkCard[]> {
    return await this.links.cardsOf(linkIds);
  }

  linkIdsSharedIn(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Set<string>> {
    return this.links.linkIdsSharedIn(groupId, linkIds);
  }
}
