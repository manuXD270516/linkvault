import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { daysSinceApplied } from './application-status.labels';

/**
 * "Postulaste hoy / ayer / hace N días" (business 9): un ICU con el plural correcto, contado en días de calendario de
 * quien mira. Lo usan el tablero y el panel.
 */
@Component({
  selector: 'lv-applied-ago',
  // El ICU es todo el contenido, sin espacios alrededor: así el mensaje es una sola unidad de i18n.
  template: `@let days = daysAgo();<span data-testid="applied-ago" i18n="@@applications.appliedAgo"
    >{days, plural, =0 {Postulaste hoy} =1 {Postulaste ayer} other {Postulaste hace {{ days }}
    días}}</span
  >`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppliedAgo {
  readonly appliedAt = input.required<string>();
  /** Instante de referencia; solo lo fijan los tests. */
  readonly now = input<Date | null>(null);

  protected readonly daysAgo = computed(() =>
    daysSinceApplied(this.appliedAt(), this.now() ?? new Date()),
  );
}
