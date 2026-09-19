import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { type AppliedDateAnswer, AppliedDateQuestion } from './applied-date-question.component';

/** Longitud máxima de la etapa; repite `STAGE_LABEL_MAX_LENGTH` de `@linkvault/shared` sin arrastrar zod. */
const STAGE_MAX_LENGTH = 60;

export interface StageDialogData {
  /** `true` si la postulación todavía no tiene fecha: la pregunta va en este mismo diálogo (critic 8). */
  askDate: boolean;
  /** La etapa actual, si ya estaba en "En proceso". */
  stageLabel?: string;
}

/** Etapa (sin texto: sin etapa) y, si se preguntó, la fecha. */
export interface StageDialogResult extends AppliedDateAnswer {
  stageLabel: string | null;
}

/**
 * Entrar en "En proceso": etapa opcional ("Entrevista", "Prueba técnica") y, si falta la fecha de postulación,
 * "¿Cuándo postulaste?" en el mismo diálogo. La etapa va primero y recibe el foco; con la pregunta a la vista, "Hoy" es
 * quien confirma, y Enter en la etapa también responde "Hoy".
 */
@Component({
  selector: 'lv-stage-dialog',
  imports: [AppliedDateQuestion, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title i18n="@@applications.stage.title">En proceso</h2>
    <form (submit)="$event.preventDefault(); submitToday()">
      <mat-dialog-content class="flex flex-col gap-2">
        <mat-form-field>
          <mat-label i18n="@@applications.stage.label">Etapa (opcional)</mat-label>
          <input
            matInput
            [attr.maxlength]="maxLength"
            [value]="stage()"
            (input)="onStage($event)"
            data-testid="stage-input"
          />
          <mat-hint i18n="@@applications.stage.hint"
            >Por ejemplo, «Entrevista» o «Prueba técnica». Solo la ves tú.</mat-hint
          >
        </mat-form-field>
        @if (data.askDate) {
          <lv-applied-date-question (answered)="submit($event)" />
        }
      </mat-dialog-content>
      <mat-dialog-actions>
        <button mat-button type="button" [mat-dialog-close]="undefined" i18n="@@confirm.cancel">
        Cancelar
      </button>
        @if (!data.askDate) {
          <button
            mat-flat-button
            type="submit"
            data-testid="stage-save"
            i18n="@@applications.stage.save"
          >
            Guardar
          </button>
        }
      </mat-dialog-actions>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageDialog {
  protected readonly data = inject<StageDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<StageDialog, StageDialogResult | undefined>>(MatDialogRef);

  protected readonly maxLength = STAGE_MAX_LENGTH;
  protected readonly stage = signal(this.data.stageLabel ?? '');
  private readonly stageLabel = computed(() => {
    const trimmed = this.stage().trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, STAGE_MAX_LENGTH);
  });

  protected onStage(event: Event): void {
    this.stage.set((event.target as HTMLInputElement).value);
  }

  /** Guardar o Enter: sin pregunta de fecha, solo la etapa; con ella, cuenta como "Hoy". */
  protected submitToday(): void {
    this.submit({});
  }

  protected submit(answer: AppliedDateAnswer): void {
    this.dialogRef.close({ ...answer, stageLabel: this.stageLabel() });
  }
}
