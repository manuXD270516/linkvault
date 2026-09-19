import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { type AppliedDateAnswer, AppliedDateQuestion } from './applied-date-question.component';

/** Clase del botón "Hoy", por la que el diálogo lo enfoca al abrirse. */
export const APPLIED_TODAY_CLASS = 'lv-applied-today';

/**
 * "¿Cuándo postulaste?" a solas, para "Postulé" desde la tarjeta y para entrar en "Postuladas", "Con oferta" o
 * "Aceptadas" sin fecha previa. Cerrarlo sin responder (Cancelar, Escape, fuera) cancela el gesto o el movimiento.
 */
@Component({
  selector: 'lv-applied-date-dialog',
  imports: [AppliedDateQuestion, MatButtonModule, MatDialogModule],
  template: `
    <mat-dialog-content>
      <lv-applied-date-question (answered)="dialogRef.close($event)" />
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" [mat-dialog-close]="undefined" i18n="@@confirm.cancel">
        Cancelar
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppliedDateDialog {
  protected readonly dialogRef =
    inject<MatDialogRef<AppliedDateDialog, AppliedDateAnswer | undefined>>(MatDialogRef);
}

/**
 * Abre la pregunta con el foco en "Hoy", para que Enter la responda. Se enfoca por selector y no con la primera parada
 * de tabulación: así lo decide el diálogo y no depende de cómo se pinten los botones. `null` si se cancela.
 */
export async function askAppliedDate(dialog: MatDialog): Promise<AppliedDateAnswer | null> {
  const answer = await firstValueFrom(
    dialog
      .open<AppliedDateDialog, undefined, AppliedDateAnswer | undefined>(AppliedDateDialog, {
        autoFocus: `.${APPLIED_TODAY_CLASS}`,
      })
      .afterClosed(),
  );
  return typeof answer === 'object' && answer !== null ? answer : null;
}
