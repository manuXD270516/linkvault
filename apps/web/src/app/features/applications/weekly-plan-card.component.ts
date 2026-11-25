import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import type { WeeklyPlanAction, WeeklyPlanDecision } from '@linkvault/shared';
import { WeeklyPlanStore } from '../../core/applications/weekly-plan.store';
import { followUpDraft } from './follow-up-draft';
import { weeklyPlanReasonText } from './weekly-plan-reason';

interface ActionRow {
  readonly action: WeeklyPlanAction;
  readonly name: string;
  readonly reason: string;
  /** Borrador de seguimiento; solo en acciones `follow_up`. */
  readonly draft: string | null;
}

/**
 * Tarjeta «Tu semana» (spec web/weekly-plan, design D10): hasta tres acciones del plan semanal con su motivo y los
 * botones «Hecho», «Ahora no» y «Ocultar sugerencia». Nunca actúa hacia fuera: no abre la oferta externa, no envía
 * mensajes y no cambia el estado de una postulación; el borrador de seguimiento se arma aquí y solo se copia.
 *
 * Pide el plan al crearse. Un fallo del plan no toca el tablero: solo esta tarjeta muestra el error.
 */
@Component({
  selector: 'lv-weekly-plan-card',
  imports: [MatButtonModule],
  templateUrl: './weekly-plan-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyPlanCard {
  protected readonly store = inject(WeeklyPlanStore);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  private readonly locale = inject(LOCALE_ID);

  /** El nombre de la oferta (o «¿Ya postulaste?») pide abrir el detalle de esa postulación (su `applicationId`). */
  readonly open = output<string>();

  protected readonly rows = computed((): ActionRow[] =>
    (this.store.plan()?.actions ?? []).map((action) => ({
      action,
      name: action.link.title ?? action.link.displayUrl,
      reason: weeklyPlanReasonText(action.reason),
      draft:
        action.rule === 'follow_up'
          ? followUpDraft(
              {
                title: action.link.title,
                company: action.link.company,
                appliedAt: action.reason.kind === 'quiet' ? action.reason.appliedAt : undefined,
              },
              this.locale,
            )
          : null,
    })),
  );

  protected readonly doneThisWeekText = computed((): string | null => {
    const done = this.store.plan()?.doneThisWeek ?? 0;
    if (done === 0) {
      return null;
    }
    return done === 1
      ? $localize`:@@applications.weeklyPlan.doneOne:Completaste 1 acción esta semana.`
      : $localize`:@@applications.weeklyPlan.doneMany:Completaste ${done}:COUNT: acciones esta semana.`;
  });

  /** `candidateId` de la acción con el borrador abierto. */
  protected readonly draftOpenId = signal<string | null>(null);
  /** `candidateId` cuyo borrador se acaba de copiar. */
  protected readonly copiedId = signal<string | null>(null);

  constructor() {
    void this.store.load();
  }

  protected retry(): void {
    void this.store.load();
  }

  protected decide(action: WeeklyPlanAction, decision: WeeklyPlanDecision): void {
    this.draftOpenId.set(null);
    this.copiedId.set(null);
    void this.store.decide(action, decision);
  }

  /** El nombre: en `ask_know_someone` lleva al grupo; en las demás abre el detalle de la postulación. */
  protected openAction(action: WeeklyPlanAction): void {
    if (action.reason.kind === 'know_someone') {
      void this.router.navigate(['/grupos', action.reason.groupId]);
      return;
    }
    this.open.emit(action.applicationId);
  }

  protected openJustApplied(applicationId: string): void {
    this.open.emit(applicationId);
  }

  protected toggleDraft(candidateId: string): void {
    this.copiedId.set(null);
    this.draftOpenId.update((current) => (current === candidateId ? null : candidateId));
  }

  protected copy(candidateId: string, draft: string): void {
    if (this.clipboard.copy(draft)) {
      this.copiedId.set(candidateId);
    }
  }
}
