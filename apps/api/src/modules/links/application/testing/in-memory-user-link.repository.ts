import { isLinkId, isUserId } from '../../domain/identifier';
import type { LinkListPage, LinkListQuery } from '../ports/link-listing';
import type { TransactionSession } from '../ports/transaction-session';
import type {
  SavedUserLink,
  SaveForUserInput,
  UserLink,
  UserLinkRepository,
} from '../ports/user-link-repository.port';
import type { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { pageOf, type StoredRelation } from './in-memory-pagination';

// Lista privada en memoria para tests de application (D10 de job-links). No es un adaptador de producción: el real es
// `MongoUserLinkRepository`. Impone lo mismo que el índice único `(userId, linkId)`: guardar dos veces el mismo link no
// crea una segunda entrada ni cambia cuándo se guardó.

interface StoredUserLink extends StoredRelation {
  readonly userId: string;
  readonly linkId: string;
}

export class InMemoryUserLinkRepository implements UserLinkRepository {
  private readonly entries: StoredUserLink[] = [];
  private nextId = 1;

  /** Sesión con la que se escribió la última entrada: un test comprueba que fue la de la transacción del alta. */
  lastSession: TransactionSession | null = null;

  constructor(private readonly links: InMemoryJobLinkRepository) {}

  /** Cuántas entradas privadas hay en total. */
  get size(): number {
    return this.entries.length;
  }

  save(
    input: SaveForUserInput,
    session: TransactionSession,
  ): Promise<SavedUserLink> {
    this.lastSession = session;
    const existing = this.entryOf(input.userId, input.linkId);
    if (existing !== undefined) {
      return Promise.resolve({ relation: toUserLink(existing), created: false });
    }
    const entry: StoredUserLink = {
      relationId: this.nextRelationId(),
      userId: input.userId,
      linkId: input.linkId,
      date: input.savedAt,
    };
    this.entries.push(entry);
    return Promise.resolve({ relation: toUserLink(entry), created: true });
  }

  find(userId: string, linkId: string): Promise<UserLink | null> {
    const entry = this.entryOf(userId, linkId);
    return Promise.resolve(entry ? toUserLink(entry) : null);
  }

  async listByUser(userId: string, query: LinkListQuery): Promise<LinkListPage> {
    if (!isUserId(userId)) {
      return { items: [] };
    }
    return await pageOf(
      this.entries.filter((entry) => entry.userId === userId),
      query,
      this.links,
      () => undefined,
    );
  }

  countByUser(userId: string): Promise<number> {
    if (!isUserId(userId)) {
      return Promise.resolve(0);
    }
    return Promise.resolve(
      this.entries.filter((entry) => entry.userId === userId).length,
    );
  }

  remove(userId: string, linkId: string): Promise<boolean> {
    const entry = this.entryOf(userId, linkId);
    if (entry === undefined) {
      return Promise.resolve(false);
    }
    this.entries.splice(this.entries.indexOf(entry), 1);
    return Promise.resolve(true);
  }

  deleteByLink(linkId: string): Promise<number> {
    let deleted = 0;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index]?.linkId === linkId) {
        this.entries.splice(index, 1);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  /** Alta directa para preparar un test, sin pasar por el caso de uso. */
  async seed(input: SaveForUserInput): Promise<UserLink> {
    const { relation } = await this.save(input, {});
    return relation;
  }

  private entryOf(
    userId: string,
    linkId: string,
  ): StoredUserLink | undefined {
    if (!isUserId(userId) || !isLinkId(linkId)) {
      return undefined;
    }
    return this.entries.find(
      (entry) => entry.userId === userId && entry.linkId === linkId,
    );
  }

  private nextRelationId(): string {
    const id = this.nextId.toString(16).padStart(24, '0');
    this.nextId += 1;
    return id;
  }
}

function toUserLink(entry: StoredUserLink): UserLink {
  return {
    userId: entry.userId,
    linkId: entry.linkId,
    savedAt: entry.date,
  };
}
