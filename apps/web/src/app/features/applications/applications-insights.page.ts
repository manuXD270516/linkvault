import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@linkvault/shared';
import { ApplicationAnalyticsStore } from '../../core/applications/application-analytics.store';
import { RequestError } from '../../shared/ui/request-error';
import { statusLabel } from './application-status.labels';

/**
 * Insights personales (`/postulaciones/insights`, design D5 / spec web/analytics): embudo byStatus,
 * open/closed/accepted y lista stale con navegación al tablero/detalle. Sin dwell.
 */
@Component({
  selector: 'lv-applications-insights-page',
  imports: [DatePipe, RequestError, RouterLink],
  providers: [ApplicationAnalyticsStore],
  templateUrl: './applications-insights.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationsInsightsPage {
  private readonly store = inject(ApplicationAnalyticsStore);

  protected readonly loading = this.store.loading;
  protected readonly loaded = this.store.loaded;
  protected readonly failure = this.store.failure;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly analytics = this.store.analytics;

  protected readonly byStatusRows = computed(() => {
    const counts = this.analytics().byStatus;
    return APPLICATION_STATUSES.map((status) => ({
      status,
      label: statusLabel(status),
      count: counts[status],
    }));
  });

  constructor() {
    void this.store.load();
  }

  protected labelOf(status: ApplicationStatus): string {
    return statusLabel(status);
  }

  /** Query params que el tablero usa para abrir el detalle de esa postulación. */
  protected boardQuery(applicationId: string, linkId: string): Record<string, string> {
    return { applicationId, linkId };
  }
}
