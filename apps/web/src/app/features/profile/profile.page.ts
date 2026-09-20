import { DatePipe } from '@angular/common';
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
import { MatSelectModule } from '@angular/material/select';
import { type MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import {
  AI_CONSENT_TEXT_VERSION,
  changePasswordRequestSchema,
  displayNameSchema,
  isAiConsentCurrent,
  type OutputLanguage,
  type UserProfile,
} from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { SessionStore } from '../../core/auth/session.store';
import { zodValidator } from '../../shared/forms/zod-validator';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Perfil: email en lectura, `displayName`, cambio de contraseña y sección "IA y privacidad" (spec web/auth, ADR-030).
 *
 * Cada control de IA se guarda solo con su campo. Activar el consentimiento envía la versión del texto que el SPA
 * muestra (`AI_CONSENT_TEXT_VERSION`), nunca otra.
 */
@Component({
  selector: 'lv-profile-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
    RequestError,
  ],
  templateUrl: './profile.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  private readonly authApi = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly passwordFormDirective = viewChild.required<FormGroupDirective>('passwordFormRef');

  /** Versión del texto de consentimiento que esta pantalla muestra (única fuente para el PATCH). */
  protected readonly shownConsentVersion = AI_CONSENT_TEXT_VERSION;

  protected readonly email = computed(() => this.session.user()?.email ?? '');
  protected readonly user = computed(() => this.session.user());

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

  /** Controles de IA: el interruptor refleja vigencia, no solo `externalProviders`. */
  protected readonly consentToggleOn = computed(() => {
    const profile = this.user();
    return profile !== null && isAiConsentCurrent(profile.aiConsent);
  });
  protected readonly consentOutdated = computed(() => {
    const profile = this.user();
    return (
      profile !== null &&
      profile.aiConsent.externalProviders &&
      profile.aiConsent.textVersion !== null &&
      profile.aiConsent.textVersion !== profile.aiConsent.currentTextVersion
    );
  });
  protected readonly consentGrantedMeta = computed(() => {
    const profile = this.user();
    if (profile === null || profile.aiConsent.consentedAt === null || profile.aiConsent.textVersion === null) {
      return null;
    }
    return {
      consentedAt: profile.aiConsent.consentedAt,
      textVersion: profile.aiConsent.textVersion,
    };
  });
  protected readonly consentSaving = signal(false);
  protected readonly consentRevokedNotice = signal(false);
  protected readonly aiFailure = signal<RequestFailure | null>(null);
  protected readonly languageSaving = signal(false);
  protected readonly redactSaving = signal(false);

  protected async saveName(): Promise<void> {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }
    this.nameSaving.set(true);
    this.nameSaved.set(false);
    this.nameFailure.set(null);
    try {
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

  /**
   * Activar envía la versión mostrada; revocar no envía versión. Si la API falla, el interruptor vuelve al valor
   * anterior (el del perfil en sesión) porque no se llama a `setUser`.
   */
  protected async onConsentToggle(change: MatSlideToggleChange): Promise<void> {
    const previous = this.user();
    if (previous === null || this.consentSaving()) {
      change.source.checked = this.consentToggleOn();
      return;
    }
    this.consentSaving.set(true);
    this.consentRevokedNotice.set(false);
    this.aiFailure.set(null);
    const enabling = change.checked;
    try {
      if (enabling) {
        await this.authApi.updateProfile({
          aiConsent: {
            externalProviders: true,
            textVersion: this.shownConsentVersion,
          },
        });
      } else {
        await this.authApi.updateProfile({
          aiConsent: { externalProviders: false },
        });
        this.consentRevokedNotice.set(true);
      }
    } catch (error: unknown) {
      change.source.checked = this.consentToggleOnFrom(previous);
      this.aiFailure.set(toRequestFailure(error));
    } finally {
      this.consentSaving.set(false);
    }
  }

  protected async onOutputLanguage(language: OutputLanguage): Promise<void> {
    const previous = this.user();
    if (previous === null || previous.outputLanguage === language || this.languageSaving()) {
      return;
    }
    this.languageSaving.set(true);
    this.aiFailure.set(null);
    try {
      await this.authApi.updateProfile({ outputLanguage: language });
    } catch (error: unknown) {
      this.aiFailure.set(toRequestFailure(error));
    } finally {
      this.languageSaving.set(false);
    }
  }

  protected async onRedactNameToggle(change: MatSlideToggleChange): Promise<void> {
    const previous = this.user();
    if (previous === null || this.redactSaving()) {
      change.source.checked = previous?.redactName ?? true;
      return;
    }
    this.redactSaving.set(true);
    this.aiFailure.set(null);
    try {
      await this.authApi.updateProfile({ redactName: change.checked });
    } catch (error: unknown) {
      change.source.checked = previous.redactName;
      this.aiFailure.set(toRequestFailure(error));
    } finally {
      this.redactSaving.set(false);
    }
  }

  private consentToggleOnFrom(profile: UserProfile): boolean {
    return isAiConsentCurrent(profile.aiConsent);
  }
}

/** Misma regla que la API: la nueva contraseña no puede coincidir con el email de la cuenta. */
function newPasswordDiffersFrom(email: () => string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const newPassword: unknown = group.get('newPassword')?.value;
    return email() !== '' && newPassword === email() ? { newPasswordIsEmail: true } : null;
  };
}
