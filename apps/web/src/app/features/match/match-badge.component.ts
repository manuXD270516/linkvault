import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  matchBadgeDegradedLabel,
  matchBadgeExplainer,
  matchBadgeLabel,
  matchBadgeLevel,
} from './match-badge';

/**
 * Badge de encaje: número + etiqueta en el análisis completo; solo etiqueta en el básico (spec web/cv-match).
 * Lo usan el diálogo (grupo 15) y las tarjetas de `/postulaciones` (tarea 16.15).
 */
@Component({
  selector: 'lv-match-badge',
  template: `
    <div
      class="flex flex-col gap-1"
      [attr.data-level]="degraded() ? 'degraded' : level()"
      data-testid="match-badge"
    >
      @if (degraded()) {
        <p class="m-0 font-medium" data-testid="match-badge-label">{{ degradedLabel }}</p>
      } @else {
        <p class="m-0 flex items-baseline gap-2 font-medium">
          <span class="text-2xl tabular-nums" data-testid="match-badge-score">{{ score() }}</span>
          <span data-testid="match-badge-label">{{ label() }}</span>
        </p>
      }
      <p class="m-0 text-sm" data-testid="match-badge-explainer">{{ explainer }}</p>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchBadge {
  /** Puntuación 0–100; en degradado no se pinta aunque venga. */
  readonly score = input.required<number>();
  readonly degraded = input(false);

  protected readonly level = computed(() => matchBadgeLevel(this.score()));
  protected readonly label = computed(() => matchBadgeLabel(this.level()));
  protected readonly degradedLabel = matchBadgeDegradedLabel();
  protected readonly explainer = matchBadgeExplainer();
}
