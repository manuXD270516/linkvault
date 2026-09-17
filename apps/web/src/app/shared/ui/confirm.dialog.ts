import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, TemplateRef, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

/**
 * Textos de la confirmación; los escribe quien la pide, porque solo él sabe a qué afecta. `message` admite una plantilla
 * para los mensajes que pluralizan: un ICU solo se puede escribir (y extraer para i18n) en una plantilla.
 */
export interface ConfirmDialogData {
  title: string;
  message: string | TemplateRef<unknown>;
  confirmLabel: string;
}

/** Confirmación compartida de las acciones destructivas: devuelve `true` solo si se pulsa el botón de confirmar. */
@Component({
  selector: 'lv-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule, NgTemplateOutlet],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (messageTemplate(); as template) {
        <p><ng-container *ngTemplateOutlet="template" /></p>
      } @else {
        <p>{{ data.message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" [mat-dialog-close]="false" i18n="@@confirm.cancel">
        Cancelar
      </button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  protected messageTemplate(): TemplateRef<unknown> | null {
    return this.data.message instanceof TemplateRef ? this.data.message : null;
  }
}

/** Abre la confirmación y espera la respuesta; cerrarla de cualquier otra forma cuenta como cancelar. */
export function confirmWith(dialog: MatDialog, data: ConfirmDialogData): Promise<boolean> {
  return firstValueFrom(dialog.open(ConfirmDialog, { data }).afterClosed()).then(
    (confirmed: unknown) => confirmed === true,
  );
}
