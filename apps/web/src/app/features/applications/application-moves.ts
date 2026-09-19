import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Application, ApplicationStatus } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import { type RequestFailure, toRequestFailure } from '../../core/api/api-error';
import {
  ApplicationsStore,
  type StatusChange,
  isApplicationConflict,
} from '../../core/applications/applications.store';
import { CLOSING_STATUSES, asksAppliedDate } from './application-status.labels';
import { askAppliedDate } from './applied-date.dialog';
import type { AppliedDateAnswer } from './applied-date-question.component';
import { ClosingDialog } from './closing.dialog';
import { StageDialog, type StageDialogData, type StageDialogResult } from './stage.dialog';

/**
 * Cómo acabó un movimiento. La tarjeta solo cambia de sitio con `moved`, cuando la API ya lo confirmó; con cualquier
 * otro resultado vuelve a donde estaba (D11).
 * - `cancelled`: se cerró un diálogo sin responder.
 * - `gone`: la postulación ya no existía (se dejó de seguir en otra pestaña); ya se quitó, sin error.
 * - `conflict`: cambió en otra pestaña; ya se volvió a pedir lo que se mira.
 */
export type MoveOutcome =
  | { kind: 'moved'; application: Application }
  | { kind: 'cancelled' }
  | { kind: 'gone' }
  | { kind: 'conflict' }
  | { kind: 'failed'; failure: RequestFailure };

/**
 * Mover una postulación a otro estado con las preguntas que tocan (spec web/applications, "Mover una postulación"):
 * la etapa al entrar en "En proceso" (con la fecha en el mismo diálogo si falta), la fecha al entrar sin ella en
 * "Postuladas", "Con oferta" o "Aceptadas", y cuál de los cierres al soltar en "Cerradas". Lo comparten el arrastre, el
 * menú "Mover a…", el panel y "Postulé" en la tarjeta de una oferta que ya se sigue.
 */
@Injectable({ providedIn: 'root' })
export class ApplicationMoves {
  private readonly dialog = inject(MatDialog);
  private readonly store = inject(ApplicationsStore);

  /** Soltar en "Cerradas": pregunta cuál de los tres cierres; `null` si se cancela. */
  async chooseClosing(): Promise<ApplicationStatus | null> {
    const choice: unknown = await firstValueFrom(
      this.dialog.open<ClosingDialog, undefined, ApplicationStatus | undefined>(ClosingDialog).afterClosed(),
    );
    return CLOSING_STATUSES.find((status) => status === choice) ?? null;
  }

  /** "¿Cuándo postulaste?" a solas; `null` si se cancela. */
  askAppliedDate(): Promise<AppliedDateAnswer | null> {
    return askAppliedDate(this.dialog);
  }

  async move(application: Application, target: ApplicationStatus): Promise<MoveOutcome> {
    const change = await this.ask(application, target);
    if (change === null) {
      return { kind: 'cancelled' };
    }
    try {
      const moved = await this.store.changeStatus(application, change);
      return moved === null ? { kind: 'gone' } : { kind: 'moved', application: moved };
    } catch (error: unknown) {
      return isApplicationConflict(error)
        ? { kind: 'conflict' }
        : { kind: 'failed', failure: toRequestFailure(error) };
    }
  }

  /** Lo que hay que preguntar antes de pedir el cambio; `null` si se cancela. */
  private async ask(application: Application, target: ApplicationStatus): Promise<StatusChange | null> {
    const askDate = asksAppliedDate(target) && application.appliedAt === undefined;
    if (target === 'in_process') {
      const data: StageDialogData =
        application.status === 'in_process' && application.stageLabel !== undefined
          ? { askDate, stageLabel: application.stageLabel }
          : { askDate };
      const result: StageDialogResult | undefined = await firstValueFrom(
        this.dialog
          .open<StageDialog, StageDialogData, StageDialogResult | undefined>(StageDialog, { data })
          .afterClosed(),
      );
      return typeof result === 'object' && result !== null ? { status: target, ...result } : null;
    }
    if (askDate) {
      const answer = await this.askAppliedDate();
      return answer === null ? null : { status: target, ...answer };
    }
    return { status: target };
  }
}
