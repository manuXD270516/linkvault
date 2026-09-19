import type { ApplicationGroups } from '../ports/application-groups.port';
import type {
  ApplicationLinks,
  LinkCard,
} from '../ports/application-links.port';
import type { ApplicationUserDirectory } from '../ports/application-user-directory.port';
import type { Clock } from '../ports/clock.port';

// Dobles de los puertos pequeños de `applications` para tests de application (D12 de applications-tracking). No son
// adaptadores de producción: los reales viven en infrastructure, sobre las fachadas de `links`, `groups` y `users`.
// Cada uno cuenta sus llamadas, para comprobar que una petición hace un número fijo de lecturas (D6).

export class MovableClock implements Clock {
  constructor(public current = new Date('2026-09-19T12:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Links vistos por cada persona, sus fichas y los links compartidos en cada grupo. */
export class InMemoryApplicationLinks implements ApplicationLinks {
  private readonly cards = new Map<string, LinkCard>();
  private readonly readers = new Map<string, Set<string>>();
  private readonly groupLinks = new Map<string, Set<string>>();
  canReadCalls = 0;
  cardsOfCalls = 0;
  linkIdsSharedInCalls = 0;

  /** Declara un link con su ficha; por defecto sin preview. */
  withLink(linkId: string, card: Partial<LinkCard> = {}): this {
    this.cards.set(linkId, {
      id: linkId,
      displayUrl: `https://www.getonbrd.com/jobs/${linkId}`,
      platform: 'getonboard',
      previewStatus: 'pending',
      ...card,
    });
    return this;
  }

  /** Declara que esa persona ve el link (en su lista privada o en un grupo suyo). */
  readableBy(userId: string, linkId: string): this {
    const links = this.readers.get(userId) ?? new Set<string>();
    links.add(linkId);
    this.readers.set(userId, links);
    return this;
  }

  /** Deja de ver el link: sale del grupo, lo quitan o se borra el grupo. */
  unreadableBy(userId: string, linkId: string): this {
    this.readers.get(userId)?.delete(linkId);
    return this;
  }

  /** Comparte el link en el grupo. */
  sharedIn(groupId: string, linkId: string): this {
    const links = this.groupLinks.get(groupId) ?? new Set<string>();
    links.add(linkId);
    this.groupLinks.set(groupId, links);
    return this;
  }

  /** Quita el link del grupo. */
  removedFrom(groupId: string, linkId: string): this {
    this.groupLinks.get(groupId)?.delete(linkId);
    return this;
  }

  canRead(userId: string, linkId: string): Promise<boolean> {
    this.canReadCalls += 1;
    return Promise.resolve(
      this.cards.has(linkId) &&
        (this.readers.get(userId)?.has(linkId) ?? false),
    );
  }

  cardsOf(linkIds: readonly string[]): Promise<LinkCard[]> {
    this.cardsOfCalls += 1;
    return Promise.resolve(
      [...new Set(linkIds)]
        .map((linkId) => this.cards.get(linkId))
        .filter((card): card is LinkCard => card !== undefined)
        .map((card) => ({ ...card })),
    );
  }

  linkIdsSharedIn(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Set<string>> {
    this.linkIdsSharedInCalls += 1;
    const shared = this.groupLinks.get(groupId) ?? new Set<string>();
    return Promise.resolve(
      new Set(linkIds.filter((linkId) => shared.has(linkId))),
    );
  }
}

/** Miembros de cada grupo. */
export class InMemoryApplicationGroups implements ApplicationGroups {
  private readonly members = new Map<string, Set<string>>();
  memberIdsOfCalls = 0;

  withMember(groupId: string, userId: string): this {
    const members = this.members.get(groupId) ?? new Set<string>();
    members.add(userId);
    this.members.set(groupId, members);
    return this;
  }

  /** Sale del grupo o la expulsan. */
  withoutMember(groupId: string, userId: string): this {
    this.members.get(groupId)?.delete(userId);
    return this;
  }

  /** Borra el grupo entero. */
  deleted(groupId: string): this {
    this.members.delete(groupId);
    return this;
  }

  memberIdsOf(groupId: string): Promise<string[]> {
    this.memberIdsOfCalls += 1;
    return Promise.resolve([...(this.members.get(groupId) ?? [])]);
  }
}

/** Nombres visibles por id. */
export class InMemoryApplicationUserDirectory implements ApplicationUserDirectory {
  private readonly names = new Map<string, string>();
  displayNamesOfCalls = 0;

  withUser(userId: string, displayName: string): this {
    this.names.set(userId, displayName);
    return this;
  }

  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    this.displayNamesOfCalls += 1;
    const found = new Map<string, string>();
    for (const userId of userIds) {
      const name = this.names.get(userId);
      if (name !== undefined) {
        found.set(userId, name);
      }
    }
    return Promise.resolve(found);
  }
}
