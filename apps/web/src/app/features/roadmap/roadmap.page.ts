import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { RoadmapItem, RoadmapResourceType } from '@linkvault/shared';
import { map } from 'rxjs';
import { isApiFailure } from '../../core/api/api-error';
import { RoadmapStore } from '../../core/roadmap/roadmap.store';
import { RequestError } from '../../shared/ui/request-error';
import { groupItemsByWeeks, roadmapResourceTypeLabel } from './roadmap-labels';

/**
 * Pantalla del plan de estudio (`/plan/:analysisId`, spec web/roadmap).
 * Sondea mientras `generating`; muestra ítems por semanas cuando `ready`; mensaje honesto si `failed`.
 */
@Component({
  selector: 'lv-roadmap-page',
  imports: [MatButtonModule, RouterLink, RequestError],
  providers: [RoadmapStore],
  templateUrl: './roadmap.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoadmapPage {
  private readonly store = inject(RoadmapStore);
  private readonly route = inject(ActivatedRoute);

  private readonly analysisId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('analysisId'))),
    { initialValue: this.route.snapshot.paramMap.get('analysisId') },
  );

  protected readonly loading = this.store.loading;
  protected readonly requesting = this.store.requesting;
  protected readonly exporting = this.store.exporting;
  protected readonly status = this.store.status;
  protected readonly isGenerating = this.store.isGenerating;
  protected readonly isReady = this.store.isReady;
  protected readonly isFailed = this.store.isFailed;
  protected readonly failure = this.store.failure;
  protected readonly exportFailure = this.store.exportFailure;
  protected readonly sortedItems = this.store.sortedItems;

  protected readonly weekGroups = computed(() => groupItemsByWeeks(this.sortedItems()));

  protected readonly notEligible = computed(() =>
    isApiFailure(this.failure(), 409, 'roadmap_not_eligible'),
  );

  protected readonly notFound = computed(() =>
    isApiFailure(this.failure(), 404, 'analysis_not_found'),
  );

  constructor() {
    const id = this.analysisId();
    if (id !== null && id.length > 0) {
      void this.store.load(id);
    }
  }

  protected resourceTypeLabel(type: RoadmapResourceType): string {
    return roadmapResourceTypeLabel(type);
  }

  protected exportMarkdown(): void {
    void this.store.exportMarkdown();
  }

  protected trackItem(item: RoadmapItem): string {
    return `${item.skill}:${String(item.priority)}:${String(item.estimatedWeeks)}`;
  }
}
