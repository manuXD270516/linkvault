import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { forgotPasswordRequestSchema } from '@linkvault/shared';
import { type RequestFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';

@Component({
  selector: 'lv-forgot-password-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
    RouterLink,
  ],
  templateUrl: './forgot-password.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordPage {
  private readonly authApi = inject(AuthApi);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', zodValidator(forgotPasswordRequestSchema.shape.email)],
  });
  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    try {
      await this.authApi.forgotPassword(forgotPasswordRequestSchema.parse(this.form.getRawValue()));
      this.sent.set(true);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
