import type { UniverseOffer } from '../../domain/group-brief-universe';
import type {
  GroupBriefCatalog,
  GroupBriefGroupPage,
  StoredGroupBriefs,
} from '../ports/group-brief.ports';
import type { InMemoryGroupBriefStore } from './in-memory-group-brief.store';

/** Doble en memoria del catálogo: grupos con sus ofertas; lo guardado lo lee del store en memoria. */
export class InMemoryGroupBriefCatalog implements GroupBriefCatalog {
  private readonly offersByGroup = new Map<string, readonly UniverseOffer[]>();
  /** Documentos que se devuelven tal cual (por `groupId:weekKey`), aunque estén ilegibles. */
  readonly rawStored = new Map<string, Readonly<Record<string, unknown>>>();

  constructor(private readonly store: InMemoryGroupBriefStore) {}

  addGroup(groupId: string, offers: readonly UniverseOffer[]): void {
    this.offersByGroup.set(groupId, offers);
  }

  listGroupIds(
    afterId: string | null,
    limit: number,
  ): Promise<GroupBriefGroupPage> {
    const ids = [...this.offersByGroup.keys()]
      .sort()
      .filter((id) => afterId === null || id > afterId)
      .slice(0, limit);
    const last = ids[ids.length - 1];
    return Promise.resolve({
      groupIds: ids,
      nextCursor: ids.length === limit && last !== undefined ? last : null,
    });
  }

  currentBriefsOf(
    groupIds: readonly string[],
    weekKey: string,
  ): Promise<StoredGroupBriefs> {
    const found = new Map<string, Readonly<Record<string, unknown>>>();
    for (const groupId of groupIds) {
      const raw = this.rawStored.get(`${groupId}:${weekKey}`);
      const doc: object | undefined = raw ?? this.store.get(groupId, weekKey);
      if (doc !== undefined) {
        found.set(groupId, doc as Readonly<Record<string, unknown>>);
      }
    }
    return Promise.resolve(found);
  }

  scanGroupOffers(
    groupId: string,
    limit: number,
  ): Promise<readonly UniverseOffer[]> {
    return Promise.resolve(
      (this.offersByGroup.get(groupId) ?? []).slice(0, limit),
    );
  }
}
