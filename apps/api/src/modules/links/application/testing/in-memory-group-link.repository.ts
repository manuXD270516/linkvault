import { isGroupId, isLinkId } from '../../domain/identifier';
import type {
  GroupLink,
  GroupLinkRepository,
  ShareInGroupInput,
  SharedGroupLink,
} from '../ports/group-link-repository.port';
import type { LinkListPage, LinkListQuery } from '../ports/link-listing';
import type { TransactionSession } from '../ports/transaction-session';
import type { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { pageOf, type StoredRelation } from './in-memory-pagination';

// Relación grupo–vacante en memoria para tests de application (D10 de job-links). No es un adaptador de producción: el
// real es `MongoGroupLinkRepository`. Impone lo mismo que el índice único `(groupId, linkId)`: un grupo tiene cada link
// una sola vez y quien lo compartió primero no cambia.

interface StoredGroupLink extends StoredRelation {
  readonly groupId: string;
  readonly linkId: string;
  readonly sharedBy: string;
}

export class InMemoryGroupLinkRepository implements GroupLinkRepository {
  private readonly relations: StoredGroupLink[] = [];
  private nextId = 1;

  /** Sesión con la que se escribió la última relación: un test comprueba que fue la de la transacción del alta. */
  lastSession: TransactionSession | null = null;
  /** Cuántas veces se preguntó por los grupos que ya tienen un link: lo usa el test que descarta el N+1 (D4). */
  groupsWithLinkCalls = 0;

  constructor(private readonly links: InMemoryJobLinkRepository) {}

  /** Cuántas relaciones hay en total; lo usan los tests del borrado en cascada. */
  get size(): number {
    return this.relations.length;
  }

  share(
    input: ShareInGroupInput,
    session: TransactionSession,
  ): Promise<SharedGroupLink> {
    this.lastSession = session;
    const existing = this.relationOf(input.groupId, input.linkId);
    if (existing !== undefined) {
      return Promise.resolve({ relation: toGroupLink(existing), created: false });
    }
    const relation: StoredGroupLink = {
      relationId: this.nextRelationId(),
      groupId: input.groupId,
      linkId: input.linkId,
      sharedBy: input.sharedBy,
      date: input.sharedAt,
    };
    this.relations.push(relation);
    return Promise.resolve({ relation: toGroupLink(relation), created: true });
  }

  find(groupId: string, linkId: string): Promise<GroupLink | null> {
    const relation = this.relationOf(groupId, linkId);
    return Promise.resolve(relation ? toGroupLink(relation) : null);
  }

  async listByGroup(
    groupId: string,
    query: LinkListQuery,
  ): Promise<LinkListPage> {
    if (!isGroupId(groupId)) {
      return { items: [] };
    }
    return await pageOf(
      this.relations.filter((relation) => relation.groupId === groupId),
      query,
      this.links,
      (relation) => relation.sharedBy,
    );
  }

  countByGroup(groupId: string): Promise<number> {
    if (!isGroupId(groupId)) {
      return Promise.resolve(0);
    }
    return Promise.resolve(
      this.relations.filter((relation) => relation.groupId === groupId).length,
    );
  }

  groupsWithLink(
    groupIds: readonly string[],
    linkId: string,
  ): Promise<Set<string>> {
    this.groupsWithLinkCalls += 1;
    const wanted = new Set(groupIds.filter((groupId) => isGroupId(groupId)));
    const found = new Set<string>();
    if (!isLinkId(linkId)) {
      return Promise.resolve(found);
    }
    for (const relation of this.relations) {
      if (relation.linkId === linkId && wanted.has(relation.groupId)) {
        found.add(relation.groupId);
      }
    }
    return Promise.resolve(found);
  }

  remove(groupId: string, linkId: string): Promise<boolean> {
    const relation = this.relationOf(groupId, linkId);
    if (relation === undefined) {
      return Promise.resolve(false);
    }
    this.relations.splice(this.relations.indexOf(relation), 1);
    return Promise.resolve(true);
  }

  deleteByGroup(
    groupId: string,
    session: TransactionSession,
  ): Promise<number> {
    this.lastSession = session;
    return Promise.resolve(
      this.deleteWhere((relation) => relation.groupId === groupId),
    );
  }

  deleteByLink(linkId: string): Promise<number> {
    return Promise.resolve(
      this.deleteWhere((relation) => relation.linkId === linkId),
    );
  }

  /** Alta directa para preparar un test, sin pasar por el caso de uso. */
  async seed(input: ShareInGroupInput): Promise<GroupLink> {
    const { relation } = await this.share(input, {});
    return relation;
  }

  private relationOf(
    groupId: string,
    linkId: string,
  ): StoredGroupLink | undefined {
    if (!isGroupId(groupId) || !isLinkId(linkId)) {
      return undefined;
    }
    return this.relations.find(
      (relation) => relation.groupId === groupId && relation.linkId === linkId,
    );
  }

  private deleteWhere(matches: (relation: StoredGroupLink) => boolean): number {
    let deleted = 0;
    for (let index = this.relations.length - 1; index >= 0; index -= 1) {
      const relation = this.relations[index];
      if (relation !== undefined && matches(relation)) {
        this.relations.splice(index, 1);
        deleted += 1;
      }
    }
    return deleted;
  }

  private nextRelationId(): string {
    const id = this.nextId.toString(16).padStart(24, '0');
    this.nextId += 1;
    return id;
  }
}

function toGroupLink(relation: StoredGroupLink): GroupLink {
  return {
    groupId: relation.groupId,
    linkId: relation.linkId,
    sharedBy: relation.sharedBy,
    sharedAt: relation.date,
  };
}
