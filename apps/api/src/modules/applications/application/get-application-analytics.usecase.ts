import {
  APPLICATION_ANALYTICS_STALE_CAP,
  APPLICATION_STATUSES,
  APPLICATION_STALE_AFTER_DAYS,
  isClosedStatus,
  type ApplicationAnalyticsByStatus,
  type ApplicationAnalyticsResponse,
  type ApplicationAnalyticsStaleItem,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Application } from '../domain/application.entity';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';
import { APPLICATIONS_CLOCK, type Clock } from './ports/clock.port';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `GET /api/applications/analytics` (ADR-039): embudo on-read del dueño. Agrega sobre `listByUser`, sin dual-write.
 * `accepted` no cuenta como closed; stale excluye closed y `accepted` (distinto del detector de email B4).
 */
@Injectable()
export class GetApplicationAnalytics {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string): Promise<ApplicationAnalyticsResponse> {
    const applications = await this.applications.listByUser(userId);
    const byStatus = emptyByStatus();
    let closedCount = 0;
    let acceptedCount = 0;

    for (const application of applications) {
      byStatus[application.status] += 1;
      if (isClosedStatus(application.status)) {
        closedCount += 1;
      } else if (application.status === 'accepted') {
        acceptedCount += 1;
      }
    }

    const total = applications.length;
    const openCount = total - closedCount - acceptedCount;
    const stale = pickStale(applications, this.clock.now());

    return { byStatus, openCount, closedCount, acceptedCount, stale };
  }
}

function emptyByStatus(): ApplicationAnalyticsByStatus {
  return Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, 0]),
  ) as ApplicationAnalyticsByStatus;
}

function pickStale(
  applications: readonly Application[],
  now: Date,
): ApplicationAnalyticsStaleItem[] {
  const thresholdMs = now.getTime() - APPLICATION_STALE_AFTER_DAYS * DAY_MS;
  return applications
    .filter((application) => isAnalyticsStale(application, thresholdMs))
    .sort(
      (left, right) =>
        left.statusChangedAt.getTime() - right.statusChangedAt.getTime() ||
        left.id.localeCompare(right.id),
    )
    .slice(0, APPLICATION_ANALYTICS_STALE_CAP)
    .map(toStaleItem);
}

/** Elegibilidad insights: no closed y no accepted; `statusChangedAt` ≤ umbral (ADR-039). */
function isAnalyticsStale(
  application: Application,
  thresholdMs: number,
): boolean {
  if (isClosedStatus(application.status) || application.status === 'accepted') {
    return false;
  }
  return application.statusChangedAt.getTime() <= thresholdMs;
}

function toStaleItem(application: Application): ApplicationAnalyticsStaleItem {
  return {
    applicationId: application.id,
    linkId: application.linkId,
    status: application.status,
    statusChangedAt: application.statusChangedAt.toISOString(),
  };
}
