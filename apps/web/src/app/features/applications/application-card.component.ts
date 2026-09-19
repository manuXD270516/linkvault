import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import type { Application, ApplicationStatus } from '@linkvault/shared';
import { linkLabel, platformName } from '../links/link-preview';
import { MOVABLE_STATUSES, columnOf, statusLabel } from './application-status.labels';
import { AppliedAgo } from './applied-ago.component';

/**
 * Tarjeta de una postulación en el tablero (spec web/applications, "Tablero de postulaciones"): la oferta (su título o
 * la etiqueta de su URL), la empresa, la plataforma, la etapa en "En proceso", la fecha de postulación y la marca de
 * compartida. En "Cerradas" dice además cuál de los tres cierres es.
 *
 * Es presentacional: abrir el panel y mover los decide el tablero. "Mover a…" es la alternativa sin ratón al arrastre.
 */
@Component({
  selector: 'lv-application-card',
  imports: [AppliedAgo, MatButtonModule, MatMenuModule],
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

  /** Todos los estados salvo `saved` y el actual, con su nombre neutro. */
  protected readonly targets = computed(() =>
    MOVABLE_STATUSES.filter((status) => status !== this.application().status).map((status) => ({
      status,
      label: statusLabel(status),
    })),
  );
}
