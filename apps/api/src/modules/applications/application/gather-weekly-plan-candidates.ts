import { isClosedStatus, WEEKLY_PLAN_SCAN_MAX } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Application } from '../domain/application.entity';
import type { PlanCandidateFacts } from '../domain/weekly-plan/weekly-plan';
import { isoWeekKey } from '../domain/weekly-plan/week-key';
import { ApplicationFitScores } from './application-fit-scores';
import {
  APPLICATION_LINKS,
  type ApplicationLinks,
  type LinkPlanSignals,
} from './ports/application-links.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Una candidata con sus hechos canónicos y lo que hace falta para volver a ids reales. */
export interface GatheredApplication {
  readonly facts: PlanCandidateFacts;
  readonly application: Application;
  readonly link: LinkPlanSignals;
}

export interface GatheredWeeklyPlan {
  /** Fecha UTC de hoy `YYYY-MM-DD`. */
  readonly today: string;
  readonly weekKey: string;
  /** Hechos canónicos en orden de clave (que coincide con el de `applicationId`). */
  readonly candidates: readonly PlanCandidateFacts[];
  /** Clave opaca → postulación y link reales. */
  readonly byKey: ReadonlyMap<string, GatheredApplication>;
}

/**
 * Recolecta las candidatas del plan semanal (D2 y D12 de weekly-plan): solo lecturas. Lee las postulaciones del usuario,
 * deja las abiertas (ni cerradas ni `accepted`), se queda con las `WEEKLY_PLAN_SCAN_MAX` de `statusChangedAt` más antiguo
 * (C6), pide las señales de links en una sola llamada a la fachada y el encaje solo de las `saved`/`interested`, y lo
 * traduce a hechos canónicos: días relativos, `today` y una clave opaca por postulación.
 */
@Injectable()
export class GatherWeeklyPlanCandidates {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATION_LINKS) private readonly links: ApplicationLinks,
    private readonly fitScores: ApplicationFitScores,
  ) {}

  async execute(userId: string, now: Date): Promise<GatheredWeeklyPlan> {
    const today = now.toISOString().slice(0, 10);
    const weekKey = isoWeekKey(now);

    const open = (await this.applications.listByUser(userId))
      .filter(
        (application) =>
          !isClosedStatus(application.status) &&
          application.status !== 'accepted',
      )
      .sort(
        (a, b) =>
          a.statusChangedAt.getTime() - b.statusChangedAt.getTime() ||
          compareIds(a.id, b.id),
      )
      .slice(0, WEEKLY_PLAN_SCAN_MAX);

    const signals =
      open.length === 0
        ? new Map<string, LinkPlanSignals>()
        : await this.links.planSignalsOf(userId, [
            ...new Set(open.map((application) => application.linkId)),
          ]);

    // Una postulación cuyo link ya no existe no aporta nada. Las claves siguen el orden de `applicationId`.
    const kept = open
      .filter((application) => signals.has(application.linkId))
      .sort((a, b) => compareIds(a.id, b.id));

    const fitLinkIds = kept
      .filter(
        (application) =>
          application.status === 'saved' || application.status === 'interested',
      )
      .map((application) => application.linkId);
    const fits =
      fitLinkIds.length === 0
        ? new Map<string, { score: number; degraded: boolean }>()
        : await this.fitScores.scoresFor(userId, fitLinkIds);

    const candidates: PlanCandidateFacts[] = [];
    const byKey = new Map<string, GatheredApplication>();
    kept.forEach((application, index) => {
      const link = signals.get(application.linkId);
      if (link === undefined) {
        return;
      }
      const key = `c${String(index + 1).padStart(3, '0')}`;
      const facts = factsOf(key, application, link, fits, now, today);
      candidates.push(facts);
      byKey.set(key, { facts, application, link });
    });

    return { today, weekKey, candidates, byKey };
  }
}

function factsOf(
  key: string,
  application: Application,
  link: LinkPlanSignals,
  fits: ReadonlyMap<string, { score: number; degraded: boolean }>,
  now: Date,
  today: string,
): PlanCandidateFacts {
  const fit = fits.get(application.linkId);
  const daysUntilExpiry =
    link.expiresAt !== undefined && DATE_ONLY.test(link.expiresAt)
      ? Math.round(
          (Date.parse(`${link.expiresAt}T00:00:00Z`) -
            Date.parse(`${today}T00:00:00Z`)) /
            DAY_MS,
        )
      : undefined;
  return {
    key,
    status: application.status,
    linkClosed: link.closed,
    daysQuiet: Math.max(
      0,
      Math.floor((now.getTime() - application.statusChangedAt.getTime()) / DAY_MS),
    ),
    ...(application.appliedAt === undefined
      ? {}
      : { appliedAt: application.appliedAt.toISOString() }),
    ...(link.expiresAt === undefined || daysUntilExpiry === undefined
      ? {}
      : { expiresAt: link.expiresAt, daysUntilExpiry }),
    ...(fit === undefined
      ? {}
      : { fit: { score: Math.round(fit.score), degraded: fit.degraded } }),
    ...(link.knowSomeoneCount > 0 && link.knowSomeoneGroupId !== undefined
      ? {
          knowSomeone: {
            count: link.knowSomeoneCount,
            groupId: link.knowSomeoneGroupId,
          },
        }
      : {}),
  };
}

function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
