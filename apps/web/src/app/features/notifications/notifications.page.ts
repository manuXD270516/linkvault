import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import type { PatchNotificationPreferencesRequest } from '@linkvault/shared';
import { NotificationsStore } from '../../core/notifications/notifications.store';
import {
  PushNotifications,
  type PushEnableOutcome,
} from '../../core/notifications/push-notifications';
import { GroupsStore } from '../../core/groups/groups.store';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Valor centinela de la opción «Todos mis grupos (unión del link)». `mat-option` con valor `null` es la opción de
 * reinicio de Material y no se pinta como elegida: el formulario usa este valor y lo traduce a `null` al guardar y
 * desde `null` al cargar (design D5 de usage-guide-fixes). La API no cambia.
 */
const ALL_GROUPS = '__all__';

/**
 * Preferencias de notificación y Web Push (spec web/notifications + web/auth).
 * Enlace desde `/perfil`; email sigue editable si push falla o se niega el permiso.
 */
@Component({
  selector: 'lv-notifications-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
    RequestError,
    RouterLink,
  ],
  providers: [NotificationsStore],
  templateUrl: './notifications.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsPage {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly store = inject(NotificationsStore);
  private readonly groups = inject(GroupsStore);
  private readonly push = inject(PushNotifications);

  protected readonly loading = this.store.loading;
  protected readonly loaded = this.store.loaded;
  protected readonly saving = this.store.saving;
  protected readonly failure = this.store.failure;
  protected readonly saveFailure = this.store.saveFailure;
  protected readonly preferences = this.store.preferences;
  protected readonly groupOptions = this.groups.groups;
  protected readonly allGroups = ALL_GROUPS;

  protected readonly pushSupported = this.push.supported();
  protected readonly pushSubscribed = this.push.subscribed;
  protected readonly pushFailure = this.push.failure;
  protected readonly pushBusy = signal(false);
  protected readonly pushNotice = signal<PushEnableOutcome['kind'] | null>(null);
  protected readonly saved = signal(false);

  protected readonly form = this.formBuilder.group({
    groupNewLink: true,
    applicationStatusGroup: true,
    applicationStale: true,
    groupWeeklyDigest: true,
    notifyOwnActions: true,
    applicationStatusGroupId: ALL_GROUPS,
  });

  protected readonly formReady = computed(() => this.loaded());

  constructor() {
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    await Promise.all([this.store.load(), this.groups.load(), this.push.refreshStatus()]);
    if (this.store.loaded()) {
      this.syncFormFromStore();
    }
  }

  private syncFormFromStore(): void {
    const prefs = this.store.preferences();
    this.form.reset({
      groupNewLink: prefs.groupNewLink,
      applicationStatusGroup: prefs.applicationStatusGroup,
      applicationStale: prefs.applicationStale,
      groupWeeklyDigest: prefs.groupWeeklyDigest,
      notifyOwnActions: prefs.notifyOwnActions,
      applicationStatusGroupId: prefs.applicationStatusGroupId ?? ALL_GROUPS,
    });
  }

  protected async save(): Promise<void> {
    this.saved.set(false);
    const raw = this.form.getRawValue();
    const patch: PatchNotificationPreferencesRequest = {
      groupNewLink: raw.groupNewLink,
      applicationStatusGroup: raw.applicationStatusGroup,
      applicationStale: raw.applicationStale,
      groupWeeklyDigest: raw.groupWeeklyDigest,
      notifyOwnActions: raw.notifyOwnActions,
      applicationStatusGroupId: raw.applicationStatusGroupId === ALL_GROUPS ? null : raw.applicationStatusGroupId,
    };
    const ok = await this.store.save(patch);
    if (ok) {
      this.syncFormFromStore();
      this.saved.set(true);
    }
  }

  protected async togglePush(enable: boolean): Promise<void> {
    this.pushBusy.set(true);
    this.pushNotice.set(null);
    try {
      const outcome = enable ? await this.push.enable() : await this.push.disable();
      this.pushNotice.set(outcome.kind);
    } finally {
      this.pushBusy.set(false);
    }
  }
}
