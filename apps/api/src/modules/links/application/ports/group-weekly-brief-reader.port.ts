import type { GroupWeeklyBrief } from '@linkvault/shared';

// Puerto de lectura de «La semana del grupo» (design D8 de group-weekly-brief). La api solo lee: el documento lo
// escribe el worker. El adaptador convierte el documento de Mongo al contrato y lo valida con zod.

export const GROUP_WEEKLY_BRIEF_READER = Symbol('GROUP_WEEKLY_BRIEF_READER');

/** `'invalid'`: hay un documento pero no cumple el contrato; `null`: no hay documento (o el id está mal formado). */
export type CurrentGroupBrief = GroupWeeklyBrief | 'invalid' | null;

export interface GroupWeeklyBriefReader {
  /** El documento de **esa** semana; nunca cae a la anterior. */
  findCurrent(groupId: string, weekKey: string): Promise<CurrentGroupBrief>;
}
