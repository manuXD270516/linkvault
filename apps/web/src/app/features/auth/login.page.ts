import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { loginRequestSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { safeReturnUrl } from '../../core/auth/return-url';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';
import { navigationStateEmail, returnUrlQueryParams } from './auth-navigation';

@Component({
  selector: 'lv-login-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
    RouterLink,
  ],
  templateUrl: './login.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly returnUrl = safeReturnUrl(
    inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'),
  );

  protected readonly form = inject(NonNullableFormBuilder).group({
    // El email llega por `state` desde el registro ("Email ya registrado"), nunca por la URL.
    email: [navigationStateEmail(this.router), zodValidator(loginRequestSchema.shape.email)],
    password: ['', zodValidator(loginRequestSchema.shape.password)],
  });
  protected readonly passwordVisible = signal(false);
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly invalidCredentials = computed(() =>
    isApiFailure(this.failure(), 401, 'invalid_credentials'),
  );
  protected readonly returnQueryParams = returnUrlQueryParams(this.returnUrl);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    try {
      await this.authApi.login(loginRequestSchema.parse(this.form.getRawValue()));
      await this.router.navigateByUrl(this.returnUrl);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
