import type {
  ApplicationAnalyticsByStatus,
  ApplicationAnalyticsResponse,
  ApplicationAnalyticsStaleItem,
} from '@linkvault/shared';
import { APPLICATION_STATUSES } from '@linkvault/shared';

export type {
  ApplicationAnalyticsByStatus,
  ApplicationAnalyticsResponse,
  ApplicationAnalyticsStaleItem,
};

/** Conteos en cero y `stale` vacío: shape vacío honesto del API (200). */
export function emptyApplicationAnalytics(): ApplicationAnalyticsResponse {
  const byStatus = Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, 0]),
  ) as ApplicationAnalyticsByStatus;
  return {
    byStatus,
    openCount: 0,
    closedCount: 0,
    acceptedCount: 0,
    stale: [],
  };
}

/** `true` si el usuario no tiene postulaciones (empty state de la SPA). */
export function isAnalyticsEmpty(analytics: ApplicationAnalyticsResponse): boolean {
  return (
    analytics.openCount === 0 &&
    analytics.closedCount === 0 &&
    analytics.acceptedCount === 0
  );
}
