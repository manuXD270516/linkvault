import { GROUP_BRIEF_SCAN_MAX, isoWeekKey } from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { mongo } from 'mongoose';
import { computeGroupBrief } from '../domain/compute-group-brief';
import { toDocument } from '../infrastructure/persistence/group-weekly-brief.document';
import {
  GROUP_BRIEF_CATALOG,
  GROUP_BRIEF_ENABLED,
  GROUP_BRIEF_PAGE_SIZE,
  GROUP_BRIEF_STORE,
  GROUP_BRIEF_VERIFIER,
  type GroupBriefCatalog,
  type GroupBriefStore,
  type GroupBriefVerifier,
} from './ports/group-brief.ports';

const { EJSON } = mongo.BSON;

export interface GroupBriefTickSummary {
  readonly weekKey: string;
  readonly groupsScanned: number;
  readonly upserted: number;
  readonly unchanged: number;
  readonly cleared: number;
  readonly rejected: number;
  readonly bulletsByKind: {
    readonly closing_soon: number;
    readonly skill_demand: number;
    readonly shared_last_week: number;
  };
}

type BulletKind = keyof GroupBriefTickSummary['bulletsByKind'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/**
 * Forma comparable de un documento (D2, N4): EJSON canónico sin `_id` ni `computedAt` y con las claves ordenadas.
 * Un guardado que no se puede serializar o que no se parece a un documento devuelve `null` y se sobrescribe.
 */
function canonicalForm(document: unknown): string | null {
  if (typeof document !== 'object' || document === null) {
    return null;
  }
  try {
    const { _id, computedAt, ...rest } = document as Record<string, unknown>;
    void _id;
    void computedAt;
    return EJSON.stringify(sortKeys(rest) as mongo.BSON.Document, {
      relaxed: false,
    });
  } catch {
    return null;
  }
}

/**
 * Calcula «La semana del grupo» de todos los grupos para la semana ISO en curso (design D1, D2). Es idempotente por
 * día: con los mismos datos y el mismo `asOf` no escribe. Un error en un grupo no detiene el tick.
 */
@Injectable()
export class ComputeGroupWeeklyBriefs {
  private readonly logger = new Logger(ComputeGroupWeeklyBriefs.name);

  constructor(
    @Inject(GROUP_BRIEF_CATALOG) private readonly catalog: GroupBriefCatalog,
    @Inject(GROUP_BRIEF_STORE) private readonly store: GroupBriefStore,
    @Inject(GROUP_BRIEF_ENABLED) private readonly enabled: boolean,
    @Inject(GROUP_BRIEF_VERIFIER) private readonly verify: GroupBriefVerifier,
  ) {}

  async execute(now: Date): Promise<GroupBriefTickSummary> {
    const weekKey = isoWeekKey(now);
    let groupsScanned = 0;
    let upserted = 0;
    let unchanged = 0;
    let cleared = 0;
    let rejected = 0;
    const bulletsByKind: Record<BulletKind, number> = {
      closing_soon: 0,
      skill_demand: 0,
      shared_last_week: 0,
    };

    if (this.enabled) {
      let cursor: string | null = null;
      do {
        const page = await this.catalog.listGroupIds(
          cursor,
          GROUP_BRIEF_PAGE_SIZE,
        );
        const stored = await this.catalog.currentBriefsOf(
          page.groupIds,
          weekKey,
        );
        for (const groupId of page.groupIds) {
          groupsScanned += 1;
          try {
            const outcome = await this.processGroup(
              groupId,
              now,
              weekKey,
              stored.get(groupId),
            );
            if (outcome.kind === 'cleared') cleared += 1;
            else if (outcome.kind === 'rejected') rejected += 1;
            else if (outcome.kind !== 'idle') {
              if (outcome.kind === 'upserted') upserted += 1;
              else unchanged += 1;
              for (const kind of outcome.bulletKinds) {
                bulletsByKind[kind] += 1;
              }
            }
          } catch (error: unknown) {
            // Un grupo que falla no debe dejar sin calcular a los demás; el siguiente tick lo reintenta.
            this.logger.warn(
              `group_brief_group_failed groupId=${groupId} weekKey=${weekKey} error=${
                error instanceof Error ? error.name : 'unknown'
              }`,
            );
          }
        }
        cursor = page.nextCursor;
      } while (cursor !== null);
    }

    const summary: GroupBriefTickSummary = {
      weekKey,
      groupsScanned,
      upserted,
      unchanged,
      cleared,
      rejected,
      bulletsByKind,
    };
    this.logger.log(JSON.stringify({ event: 'group_brief_tick', ...summary }));
    return summary;
  }

  private async processGroup(
    groupId: string,
    now: Date,
    weekKey: string,
    stored: Readonly<Record<string, unknown>> | undefined,
  ): Promise<
    | { kind: 'upserted'; bulletKinds: readonly BulletKind[] }
    | { kind: 'unchanged'; bulletKinds: readonly BulletKind[] }
    | { kind: 'cleared' }
    | { kind: 'rejected' }
    | { kind: 'idle' }
  > {
    const offers = await this.catalog.scanGroupOffers(
      groupId,
      GROUP_BRIEF_SCAN_MAX + 1,
    );
    const brief = computeGroupBrief({ groupId, now, offers });

    if (brief === null) {
      // Día sin viñetas (N1): se borra la semana guardada; no se deja una semana vieja que ya no es verdad.
      if (stored === undefined) {
        return { kind: 'idle' };
      }
      await this.store.clear(groupId, weekKey);
      return { kind: 'cleared' };
    }

    const verdict = this.verify(brief);
    if (!verdict.ok) {
      // Se conserva lo guardado. Solo ids y códigos: nunca contenido.
      this.logger.warn(
        `group_brief_rejected groupId=${groupId} weekKey=${weekKey} codes=${verdict.violations
          .map((v) => v.code)
          .join(',')}`,
      );
      return { kind: 'rejected' };
    }

    const bulletKinds = this.bulletKindsOf(brief);
    const document = toDocument(brief);
    const next = canonicalForm(document);
    if (
      stored !== undefined &&
      next !== null &&
      next === canonicalForm(stored)
    ) {
      return { kind: 'unchanged', bulletKinds };
    }
    await this.store.replace(document);
    return { kind: 'upserted', bulletKinds };
  }

  private bulletKindsOf(
    brief: NonNullable<ReturnType<typeof computeGroupBrief>>,
  ): BulletKind[] {
    const kinds: BulletKind[] = [];
    for (const bullet of brief.bullets) {
      const fact = brief.facts.find((f) => f.factId === bullet.factId);
      if (fact !== undefined && fact.kind !== 'open_offers') {
        kinds.push(fact.kind);
      }
    }
    return kinds;
  }
}
