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
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import {
  AI_BYOK_API_KEY_MIN_LENGTH,
  AI_CONSENT_TEXT_VERSION,
  AI_VENDORS,
  type AiVendor,
  changePasswordRequestSchema,
  displayNameSchema,
  isAiConsentCurrent,
  type OutputLanguage,
  type UserProfile,
  upsertAiKeyRequestSchema,
} from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { AiKeysStore } from '../../core/ai-keys/ai-keys.store';
import { AuthApi } from '../../core/auth/auth.api';
import { SessionStore } from '../../core/auth/session.store';
import { zodValidator } from '../../shared/forms/zod-validator';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import { confirmDeleteAccount } from './delete-account.dialog';

/** Etiquetas visibles de cada vendor (nombres de marca, sin i18n). */
const VENDOR_LABELS: Record<AiVendor, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

/**
 * Vendors cuya política de datos lleva la salvedad de `data_collection` (spec web/byok: OpenRouter).
 *
 * Es una propiedad del proveedor, no un estado: por eso vive aquí y no en la plantilla. Lo que sí es estado —si
 * ese vendor está disponible— llega del API y se consulta aparte; el aviso necesita las dos cosas.
 */
const VENDORS_WITH_DATA_COLLECTION_CAVEAT = new Set<AiVendor>(['openrouter']);

/**
 * Perfil: email en lectura, `displayName`, cambio de contraseña, sección "IA y privacidad" (spec web/auth,
 * ADR-030), claves BYOK (spec web/byok, ADR-032) y zona de peligro para borrar la cuenta (spec web/privacy).
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
    RouterLink,
  ],
  providers: [AiKeysStore],
  templateUrl: './profile.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  private readonly authApi = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly aiKeys = inject(AiKeysStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
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

  /** Filas BYOK: un formulario por vendor con aviso de destino (D12). */
  protected readonly byokVendors = AI_VENDORS.map((vendor) => ({
    vendor,
    label: VENDOR_LABELS[vendor],
  }));
  protected readonly keyDrafts = this.formBuilder.group({
    anthropic: ['', zodValidator(upsertAiKeyRequestSchema.shape.apiKey)],
    openai: ['', zodValidator(upsertAiKeyRequestSchema.shape.apiKey)],
    openrouter: ['', zodValidator(upsertAiKeyRequestSchema.shape.apiKey)],
  });
  protected readonly byokKeys = this.aiKeys.keys;
  protected readonly byokLoading = this.aiKeys.loading;
  protected readonly byokLoaded = this.aiKeys.loaded;
  protected readonly byokFailure = this.aiKeys.failure;
  protected readonly byokActionFailure = this.aiKeys.actionFailure;
  protected readonly byokSavingVendor = this.aiKeys.savingVendor;
  protected readonly byokRevokingVendor = this.aiKeys.revokingVendor;
  protected readonly byokKeyByVendor = this.aiKeys.keyByVendor;
  protected readonly byokAvailabilityByVendor = this.aiKeys.availabilityByVendor;
  /**
   * Claves guardadas con consentimiento off: se ven pero no se usan (D12).
   *
   * Solo cuenta las claves de vendors que **no** están indisponibles: para un vendor sin configuración
   * utilizable el aviso de indisponibilidad sustituye a este, porque «no se usan hasta que vuelvas a dar el
   * permiso» sería falso ahí —dar el permiso no lo activa— (spec `web/byok`, precedencia vendor a vendor).
   */
  protected readonly byokKeysInactive = computed(
    () => this.aiKeys.hasAnyUsableKey() && !this.consentToggleOn(),
  );
  protected readonly apiKeyMinLength = AI_BYOK_API_KEY_MIN_LENGTH;

  constructor() {
    void this.aiKeys.load();
  }

  protected keyFor(vendor: AiVendor) {
    return this.byokKeyByVendor().get(vendor);
  }

  /**
   * Muestra el aviso de indisponibilidad de ese vendor: el API dice que hoy no se puede construir.
   *
   * El estado viene del API (`vendors` del listado) y **no** se deduce de tener clave, del consentimiento ni
   * de ninguna regla escrita aquí: deducirlo sería reimplementar en el cliente el criterio del servidor, y la
   * pantalla podría decir «disponible» sobre un proveedor que el servidor no construye. Mientras el listado no
   * haya respondido, el estado es `undefined` y no se afirma ninguna de las dos cosas.
   */
  protected showsUnavailableNotice(vendor: AiVendor): boolean {
    return this.byokAvailabilityByVendor().get(vendor) === false;
  }

  /**
   * Muestra la nota de `data_collection` de ese vendor: solo para los que la tienen (hoy OpenRouter) y solo
   * cuando el API lo da por **disponible**.
   *
   * Para un vendor indisponible este aviso afirmaría un envío que no va a ocurrir, así que no se muestra; el de
   * indisponibilidad ocupa su sitio. Son dos estados distintos y no comparten párrafo ni `data-testid`.
   */
  protected showsDataCollectionNotice(vendor: AiVendor): boolean {
    return (
      VENDORS_WITH_DATA_COLLECTION_CAVEAT.has(vendor) &&
      this.byokAvailabilityByVendor().get(vendor) === true
    );
  }

  protected draftControl(vendor: AiVendor) {
    return this.keyDrafts.controls[vendor];
  }

  protected async saveKey(vendor: AiVendor): Promise<void> {
    const control = this.draftControl(vendor);
    if (control.invalid) {
      control.markAsTouched();
      return;
    }
    try {
      await this.aiKeys.upsert(vendor, upsertAiKeyRequestSchema.parse({ apiKey: control.value }));
      control.reset('');
    } catch {
      // El store ya dejó `actionFailure`.
    }
  }

  protected async revokeKey(vendor: AiVendor): Promise<void> {
    const label = VENDOR_LABELS[vendor];
    const confirmed = await confirmWith(this.dialog, {
      title: $localize`:@@profile.byok.revokeTitle:Revocar clave de ${label}:VENDOR:`,
      message: $localize`:@@profile.byok.revokeMessage:Se borrará la clave de ${label}:VENDOR: guardada en LinkVault. No se puede deshacer.`,
      confirmLabel: $localize`:@@profile.byok.revokeConfirm:Revocar`,
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.aiKeys.revoke(vendor);
      this.draftControl(vendor).reset('');
    } catch {
      // El store ya dejó `actionFailure`.
    }
  }

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

  /** Zona de peligro: diálogo con confirmación + contraseña; tras 204 navega a `/login` sin sesión. */
  protected async deleteAccount(): Promise<void> {
    const deleted = await confirmDeleteAccount(this.dialog);
    if (deleted) {
      await this.router.navigateByUrl('/login');
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
