import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  type AbstractControl,
  FormGroupDirective,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { changePasswordRequestSchema, displayNameSchema } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { SessionStore } from '../../core/auth/session.store';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Perfil: email en lectura, `displayName` y cambio de contraseña. Los controles de consentimiento de IA, idioma de
 * salida y redacción del nombre no se muestran en este change (ADR-020, consecuencias).
 */
@Component({
  selector: 'lv-profile-page',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, RequestError],
  templateUrl: './profile.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  private readonly authApi = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly passwordFormDirective = viewChild.required<FormGroupDirective>('passwordFormRef');

  protected readonly email = computed(() => this.session.user()?.email ?? '');

  protected readonly nameForm = this.formBuilder.group({
    displayName: [this.session.user()?.displayName ?? '', zodValidator(displayNameSchema)],
  });
  protected readonly nameSaving = signal(false);
  protected readonly nameSaved = signal(false);
  protected readonly nameFailure = signal<RequestFailure | null>(null);

  protected readonly passwordForm = this.formBuilder.group(
    {
      currentPassword: ['', zodValidator(changePasswordRequestSchema.shape.currentPassword)],
      newPassword: ['', zodValidator(changePasswordRequestSchema.shape.newPassword)],
    },
    { validators: newPasswordDiffersFrom(() => this.email()) },
  );
  protected readonly currentPasswordVisible = signal(false);
  protected readonly newPasswordVisible = signal(false);
  protected readonly passwordSaving = signal(false);
  protected readonly passwordChanged = signal(false);
  protected readonly passwordFailure = signal<RequestFailure | null>(null);
  protected readonly wrongCurrentPassword = computed(() =>
    isApiFailure(this.passwordFailure(), 401, 'invalid_credentials'),
  );
  protected readonly invalidNewPassword = computed(() =>
    isApiFailure(this.passwordFailure(), 400, 'validation_error'),
  );

  protected async saveName(): Promise<void> {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }
    this.nameSaving.set(true);
    this.nameSaved.set(false);
    this.nameFailure.set(null);
    try {
      // Solo `displayName`: el resto de campos editables no se toca desde esta página.
      const user = await this.authApi.updateProfile({
        displayName: displayNameSchema.parse(this.nameForm.controls.displayName.value),
      });
      this.nameForm.reset({ displayName: user.displayName });
      this.nameSaved.set(true);
    } catch (error: unknown) {
      this.nameFailure.set(toRequestFailure(error));
    } finally {
      this.nameSaving.set(false);
    }
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.passwordSaving.set(true);
    this.passwordChanged.set(false);
    this.passwordFailure.set(null);
    try {
      // `204` sin sesión nueva: la petición siguiente recibe 401 y el interceptor renueva (D11).
      await this.authApi.changePassword(
        changePasswordRequestSchema.parse(this.passwordForm.getRawValue()),
      );
      this.passwordFormDirective().resetForm();
      this.passwordChanged.set(true);
    } catch (error: unknown) {
      this.passwordFailure.set(toRequestFailure(error));
    } finally {
      this.passwordSaving.set(false);
    }
  }
}

/** Misma regla que la API: la nueva contraseña no puede coincidir con el email de la cuenta. */
function newPasswordDiffersFrom(email: () => string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const newPassword: unknown = group.get('newPassword')?.value;
    return email() !== '' && newPassword === email() ? { newPasswordIsEmail: true } : null;
  };
}
