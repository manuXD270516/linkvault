import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { passwordSchema, resetPasswordRequestSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';

@Component({
  selector: 'lv-reset-password-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
    RouterLink,
  ],
  templateUrl: './reset-password.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordPage {
  private readonly authApi = inject(AuthApi);
  /** Token del enlace; solo en memoria de la página (spec web/email-auth). */
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token')?.trim() ?? '';

  protected readonly form = inject(NonNullableFormBuilder).group({
    newPassword: ['', zodValidator(passwordSchema)],
  });
  protected readonly passwordVisible = signal(false);
  protected readonly submitting = signal(false);
  protected readonly succeeded = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly missingToken = this.token.length === 0;
  protected readonly invalidToken = computed(
    () => this.missingToken || isApiFailure(this.failure(), 400, 'invalid_token'),
  );

  protected async submit(): Promise<void> {
    if (this.missingToken) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    try {
      await this.authApi.resetPassword(
        resetPasswordRequestSchema.parse({
          token: this.token,
          newPassword: this.form.controls.newPassword.getRawValue(),
        }),
      );
      this.succeeded.set(true);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
