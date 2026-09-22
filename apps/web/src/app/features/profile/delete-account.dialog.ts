import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { deleteAccountRequestSchema } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Confirmación + contraseña para `DELETE /api/users/me` (spec web/privacy). Cierra con `true` tras un 204
 * (la sesión local ya quedó limpia en `AuthApi`).
 */
@Component({
  selector: 'lv-delete-account-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
  ],
  templateUrl: './delete-account.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteAccountDialog {
  private readonly authApi = inject(AuthApi);
  private readonly dialogRef = inject(MatDialogRef<DeleteAccountDialog, boolean>);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly form = this.formBuilder.group({
    password: ['', zodValidator(deleteAccountRequestSchema.shape.password)],
  });
  protected readonly passwordVisible = signal(false);
  protected readonly saving = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly wrongPassword = computed(() =>
    isApiFailure(this.failure(), 401, 'invalid_credentials'),
  );
  protected readonly soleOwner = computed(() =>
    isApiFailure(this.failure(), 409, 'sole_owner_with_members'),
  );

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.failure.set(null);
    try {
      await this.authApi.deleteAccount(
        deleteAccountRequestSchema.parse(this.form.getRawValue()),
      );
      this.dialogRef.close(true);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.saving.set(false);
    }
  }
}

/** Abre el diálogo de borrado; `true` solo si la API respondió 204. */
export function confirmDeleteAccount(dialog: MatDialog): Promise<boolean> {
  return firstValueFrom(
    dialog.open(DeleteAccountDialog, { disableClose: true }).afterClosed(),
  ).then((confirmed: unknown) => confirmed === true);
}
