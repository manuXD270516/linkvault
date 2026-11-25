import type {
  CurrentGroupBrief,
  GroupWeeklyBriefReader,
} from '../ports/group-weekly-brief-reader.port';

/** Doble en memoria del lector: lo que se guarda con `put` es lo que `findCurrent` devuelve para esa semana. */
export class InMemoryGroupWeeklyBriefReader implements GroupWeeklyBriefReader {
  private readonly briefs = new Map<string, CurrentGroupBrief>();
  reads = 0;

  put(groupId: string, weekKey: string, brief: CurrentGroupBrief): void {
    this.briefs.set(`${groupId}:${weekKey}`, brief);
  }

  findCurrent(groupId: string, weekKey: string): Promise<CurrentGroupBrief> {
    this.reads += 1;
    return Promise.resolve(this.briefs.get(`${groupId}:${weekKey}`) ?? null);
  }
}
