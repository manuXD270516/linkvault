import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import type { Application, ApplicationStatus } from '@linkvault/shared';
import { MatchBadge } from '../match/match-badge.component';
import { linkLabel, platformName } from '../links/link-preview';
import { MOVABLE_STATUSES, columnOf, statusLabel } from './application-status.labels';
import { AppliedAgo } from './applied-ago.component';

/**
 * Tarjeta de una postulación en el tablero (spec web/applications): oferta, empresa, plataforma, etapa, fecha,
 * compartida y el badge del análisis propio (completo = etiqueta+número; básico = solo etiqueta; sin análisis = nada).
 */
@Component({
  selector: 'lv-application-card',
  imports: [AppliedAgo, MatchBadge, MatButtonModule, MatMenuModule],
  templateUrl: './application-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationCard {
  readonly application = input.required<Application>();
  /** `true` mientras se mueve esta u otra tarjeta: no se puede pedir otro cambio encima. */
  readonly busy = input(false);

  readonly open = output<void>();
  readonly moveTo = output<ApplicationStatus>();

  protected readonly headline = computed(() => {
    const { title, displayUrl } = this.application().link;
    return title ?? linkLabel(displayUrl);
  });

  protected readonly platform = computed(() => platformName(this.application().link.platform));

  /** Solo en "Cerradas" hace falta decir el estado: en las demás columnas lo dice el título de la columna. */
  protected readonly closedLabel = computed(() => {
    const { status } = this.application();
    return columnOf(status) === 'closed' ? statusLabel(status) : null;
  });

  protected readonly stage = computed(() => {
    const { status, stageLabel } = this.application();
    return status === 'in_process' ? (stageLabel ?? null) : null;
  });

  /**
   * Badge del análisis propio: `null` sin análisis (ni cero ni hueco). Básico → solo etiqueta (`degraded`); completo →
   * score + etiqueta.
   */
  protected readonly fitBadge = computed((): { score: number; degraded: boolean } | null => {
    const { fitScore, fitScoreDegraded } = this.application();
    if (fitScoreDegraded === true) {
      return { score: fitScore ?? 0, degraded: true };
    }
    if (fitScore !== undefined && fitScoreDegraded === false) {
      return { score: fitScore, degraded: false };
    }
    return null;
  });

  /** Todos los estados salvo `saved` y el actual, con su nombre neutro. */
  protected readonly targets = computed(() =>
    MOVABLE_STATUSES.filter((status) => status !== this.application().status).map((status) => ({
      status,
      label: statusLabel(status),
    })),
  );
}
