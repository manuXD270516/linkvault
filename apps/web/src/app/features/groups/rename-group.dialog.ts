import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { groupNameSchema } from '@linkvault/shared';
import { zodValidator } from '../../shared/forms/zod-validator';

/** Nombre actual del grupo, con el que se abre el formulario. */
export interface RenameGroupDialogData {
  name: string;
}

/**
 * Pide el nombre nuevo con las mismas reglas que la API y lo devuelve ya normalizado; la llamada la hace el detalle,
 * que es quien sabe qué grupo se está renombrando y dónde mostrar el fallo.
 */
@Component({
  selector: 'lv-rename-group-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  templateUrl: './rename-group.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameGroupDialog {
  private readonly dialogRef =
    inject<MatDialogRef<RenameGroupDialog, string | undefined>>(MatDialogRef);
  private readonly data = inject<RenameGroupDialogData>(MAT_DIALOG_DATA);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.data.name, zodValidator(groupNameSchema)],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(groupNameSchema.parse(this.form.getRawValue().name));
  }
}
