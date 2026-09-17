import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { type GroupDetail, groupNameSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { GroupsStore } from '../../core/groups/groups.store';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Diálogo de creación: solo pide el nombre y lo valida con el schema compartido, las mismas reglas que la API. Al crear,
 * navega al detalle del grupo nuevo; un fallo deja el diálogo abierto con el nombre escrito (spec web/groups).
 */
@Component({
  selector: 'lv-create-group-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
  ],
  templateUrl: './create-group.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateGroupDialog {
  private readonly dialogRef =
    inject<MatDialogRef<CreateGroupDialog, GroupDetail | undefined>>(MatDialogRef);
  private readonly store = inject(GroupsStore);
  private readonly router = inject(Router);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', zodValidator(groupNameSchema)],
  });
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly tooManyGroups = computed(() =>
    isApiFailure(this.failure(), 409, 'too_many_groups'),
  );

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    try {
      const group = await this.store.create(groupNameSchema.parse(this.form.getRawValue().name));
      this.dialogRef.close(group);
      await this.router.navigate(['/grupos', group.id]);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
