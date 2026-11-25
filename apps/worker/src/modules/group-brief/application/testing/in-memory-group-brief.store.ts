import type { GroupWeeklyBriefDocument } from '../../infrastructure/persistence/group-weekly-brief.document';
import type { GroupBriefStore } from '../ports/group-brief.ports';

function keyOf(groupId: string, weekKey: string): string {
  return `${groupId}:${weekKey}`;
}

/** Doble en memoria del store: un documento por `(groupId, weekKey)`. */
export class InMemoryGroupBriefStore implements GroupBriefStore {
  readonly documents = new Map<string, GroupWeeklyBriefDocument>();
  replaces = 0;
  clears = 0;

  replace(document: GroupWeeklyBriefDocument): Promise<void> {
    this.replaces += 1;
    this.documents.set(
      keyOf(document.groupId.toHexString(), document.weekKey),
      document,
    );
    return Promise.resolve();
  }

  clear(groupId: string, weekKey: string): Promise<void> {
    this.clears += 1;
    this.documents.delete(keyOf(groupId, weekKey));
    return Promise.resolve();
  }

  get(groupId: string, weekKey: string): GroupWeeklyBriefDocument | undefined {
    return this.documents.get(keyOf(groupId, weekKey));
  }
}
