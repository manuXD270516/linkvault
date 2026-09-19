import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { CLOSING_STATUSES, statusLabel } from './application-status.labels';

/** Soltar en "Cerradas": cuál de los tres cierres es. Cerrarlo sin elegir cancela el movimiento. */
@Component({
  selector: 'lv-closing-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title i18n="@@applications.closing.title">¿Cómo se cerró?</h2>
    <mat-dialog-content>
      <div class="flex flex-col gap-2">
        @for (option of options; track option.status) {
          <button
            mat-stroked-button
            type="button"
            [mat-dialog-close]="option.status"
            [attr.data-status]="option.status"
          >
            {{ option.label }}
          </button>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" [mat-dialog-close]="undefined" i18n="@@confirm.cancel">
        Cancelar
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosingDialog {
  protected readonly options = CLOSING_STATUSES.map((status) => ({
    status,
    label: statusLabel(status),
  }));
}
