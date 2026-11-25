import type { GroupBriefVerdict, GroupWeeklyBrief } from '@linkvault/shared';
import type { UniverseOffer } from '../../domain/group-brief-universe';
import type { GroupWeeklyBriefDocument } from '../../infrastructure/persistence/group-weekly-brief.document';

/** Cuántos grupos se leen por página en cada tick (D2). */
export const GROUP_BRIEF_PAGE_SIZE = 50;

export interface GroupBriefGroupPage {
  readonly groupIds: readonly string[];
  /** `null` cuando no quedan más páginas. */
  readonly nextCursor: string | null;
}

/** Lo guardado de la semana en curso por grupo; `Record` porque puede estar ilegible (entonces se sobrescribe). */
export type StoredGroupBriefs = ReadonlyMap<
  string,
  Readonly<Record<string, unknown>>
>;

export const GROUP_BRIEF_CATALOG = Symbol('GROUP_BRIEF_CATALOG');
export interface GroupBriefCatalog {
  /** Grupos por `_id` ascendente, estrictamente después de `afterId`. */
  listGroupIds(
    afterId: string | null,
    limit: number,
  ): Promise<GroupBriefGroupPage>;
  /** Documentos de la semana de una página, en una sola lectura. */
  currentBriefsOf(
    groupIds: readonly string[],
    weekKey: string,
  ): Promise<StoredGroupBriefs>;
  /**
   * Universo del grupo: `sharedAt` desc e `id` desc, como mucho `limit` ofertas (el cálculo pide 501 para saber si
   * hubo más). Solo datos de las ofertas.
   */
  scanGroupOffers(
    groupId: string,
    limit: number,
  ): Promise<readonly UniverseOffer[]>;
}

export const GROUP_BRIEF_STORE = Symbol('GROUP_BRIEF_STORE');
export interface GroupBriefStore {
  /** `replaceOne` con `upsert` sobre `(groupId, weekKey)`: un solo documento por grupo y semana. */
  replace(document: GroupWeeklyBriefDocument): Promise<void>;
  /** Borra la semana de un grupo y solo esa. */
  clear(groupId: string, weekKey: string): Promise<void>;
}

export interface GroupBriefClock {
  now(): Date;
}
export const GROUP_BRIEF_CLOCK = Symbol('GROUP_BRIEF_CLOCK');

/** `FEATURE_GROUP_BRIEF` (D2): con `false`, ni cron ni tick ni cálculo. */
export const GROUP_BRIEF_ENABLED = Symbol('GROUP_BRIEF_ENABLED');

/** El evaluador de D6: se inyecta para poder forzar un rechazo en los tests. */
export const GROUP_BRIEF_VERIFIER = Symbol('GROUP_BRIEF_VERIFIER');
export type GroupBriefVerifier = (brief: GroupWeeklyBrief) => GroupBriefVerdict;
