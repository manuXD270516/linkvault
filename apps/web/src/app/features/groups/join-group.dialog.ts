import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  type AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import type { GroupSummary } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { normalizeInviteCode } from '../../core/groups/groups.api';
import { GroupsStore } from '../../core/groups/groups.store';
import { RequestError } from '../../shared/ui/request-error';

/** Código de invitación con el que se abre el diálogo; lo usa `/unirse` con el `codigo` del enlace (7.5). */
export interface JoinGroupDialogData {
  code?: string;
}

/**
 * Diálogo para unirse con un código. El cliente solo lo normaliza (espacios exteriores y mayúsculas, en `GroupsApi`):
 * el formato lo juzga la API, que responde `invalid_invite_code`, para que un código mal pegado reciba un mensaje que se
 * entiende y no el error genérico de validación (D3).
 */
@Component({
  selector: 'lv-join-group-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
  ],
  templateUrl: './join-group.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinGroupDialog {
  private readonly dialogRef =
    inject<MatDialogRef<JoinGroupDialog, GroupSummary | undefined>>(MatDialogRef);
  private readonly store = inject(GroupsStore);
  private readonly router = inject(Router);
  private readonly data = inject<JoinGroupDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  protected readonly form = inject(NonNullableFormBuilder).group({
    code: [this.data?.code ?? '', codeNotBlank],
  });
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly invalidCode = computed(() =>
    isApiFailure(this.failure(), 404, 'invalid_invite_code'),
  );
  protected readonly groupFull = computed(() => isApiFailure(this.failure(), 409, 'group_full'));
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
      const group = await this.store.join(this.form.getRawValue().code);
      this.dialogRef.close(group);
      await this.router.navigate(['/grupos', group.id]);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}

/** Único juicio del cliente sobre el código: que quede algo tras normalizarlo. */
function codeNotBlank(control: AbstractControl): ValidationErrors | null {
  return normalizeInviteCode(String(control.value ?? '')) === '' ? { required: true } : null;
}
