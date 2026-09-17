import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  type AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { emailSchema, registerRequestSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { safeReturnUrl } from '../../core/auth/return-url';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';
import { returnUrlQueryParams } from './auth-navigation';

@Component({
  selector: 'lv-register-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RequestError,
    RouterLink,
  ],
  templateUrl: './register.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterPage {
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly returnUrl = safeReturnUrl(
    inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'),
  );

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      displayName: ['', zodValidator(registerRequestSchema.shape.displayName)],
      email: ['', zodValidator(registerRequestSchema.shape.email)],
      password: ['', zodValidator(registerRequestSchema.shape.password)],
    },
    { validators: passwordDiffersFromEmail },
  );
  protected readonly passwordVisible = signal(false);
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly emailTaken = computed(() => isApiFailure(this.failure(), 409, 'email_taken'));
  /** Email con el que se intentó el registro; viaja a `/login` por `state`, nunca en la URL. */
  protected readonly attemptedEmail = signal('');
  protected readonly returnQueryParams = returnUrlQueryParams(this.returnUrl);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const body = registerRequestSchema.parse(this.form.getRawValue());
    this.submitting.set(true);
    this.failure.set(null);
    this.attemptedEmail.set(body.email);
    try {
      await this.authApi.register(body);
      await this.router.navigateByUrl(this.returnUrl);
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}

/** Misma regla que la API: la contraseña no puede coincidir con el email normalizado. */
function passwordDiffersFromEmail(group: AbstractControl): ValidationErrors | null {
  const email = emailSchema.safeParse(group.get('email')?.value);
  const password: unknown = group.get('password')?.value;
  return email.success && password === email.data ? { passwordIsEmail: true } : null;
}
